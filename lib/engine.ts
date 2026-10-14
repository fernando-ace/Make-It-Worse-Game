import { randomInt } from "node:crypto";
import type { Action, HouseRule, MinigameDefinition, PartyRound, PartySession, Player, Room, Snapshot } from "./types";

const ROUND_SECONDS = 30;
export const SESSION_GAME_COUNT = 6;
export const HOUSE_RULES: Omit<HouseRule, "effect">[] = [
  { id: "underdog", name: "Underdog", description: "The player in last place earns bonus points whenever they score.", activationPoint: "next-game", canStack: false },
  { id: "bounty", name: "Bounty", description: "Outscore the marked player's base points to earn a bonus.", activationPoint: "next-game", canStack: false },
  { id: "double-down", name: "Double Down", description: "Double points scored in each later game.", activationPoint: "next-game", canStack: true },
];

export const splitDecision: MinigameDefinition = {
  id: "split-decision",
  displayName: "Split Decision",
  instructions: "Choose RED or BLUE in secret. Players in the minority score 2 points. If both colors tie, everyone scores 1 point.",
  input: { choices: ["RED", "BLUE"] },
  resolve({ players, submissions, scores, rules }) {
    const redCount = Object.values(submissions).filter((choice) => choice === "RED").length;
    const blueCount = Object.values(submissions).filter((choice) => choice === "BLUE").length;
    const tied = redCount === blueCount;
    const lastPlace = players.reduce<string | null>((last, player) => last === null || (scores[player.id] ?? 0) < (scores[last] ?? 0) ? player.id : last, null);
    const base: Record<string, number> = {};
    const points: Record<string, number> = {};
    const reasons: Record<string, string> = {};
    for (const player of players) {
      const choice = submissions[player.id];
      const minority = !tied && ((choice === "RED" && redCount < blueCount) || (choice === "BLUE" && blueCount < redCount));
      const raw = !choice ? 0 : tied ? 1 : minority ? 2 : 0;
      let multiplier = 1;
      for (const rule of rules) if (rule.effect.type === "score-multiplier") multiplier *= rule.effect.multiplier;
      base[player.id] = raw * multiplier;
      points[player.id] = base[player.id];
      if (!choice) reasons[player.id] = "No choice before time ran out: 0 points.";
      else if (tied) reasons[player.id] = `Color tie: +${base[player.id]} point${base[player.id] === 1 ? "" : "s"}.`;
      else if (minority) reasons[player.id] = `Minority choice: +${base[player.id]} points${multiplier > 1 ? ` (${multiplier}x)` : ""}.`;
      else reasons[player.id] = "Majority choice: no points this round.";
      let bonus = 0;
      if (player.id === lastPlace && raw > 0) for (const rule of rules) if (rule.effect.type === "last-place-bonus") bonus += rule.effect.points;
      if (bonus) { points[player.id] += bonus; reasons[player.id] += ` Underdog bonus: +${bonus}.`; }
    }
    for (const rule of rules) if (rule.effect.type === "bounty") {
      const targetBase = base[rule.effect.targetId];
      if (targetBase !== undefined) for (const player of players) if (player.id !== rule.effect.targetId && base[player.id] > targetBase) {
        points[player.id] += rule.effect.points;
        reasons[player.id] += ` Bounty bonus: +${rule.effect.points}.`;
      }
    }
    return { choices: submissions as Record<string, "RED" | "BLUE">, points, reasons, redCount, blueCount };
  },
};

// Register future games here; room/session orchestration stays game-agnostic.
export const MINIGAMES: Record<string, MinigameDefinition> = { [splitDecision.id]: splitDecision };

export function registerMinigame(definition: MinigameDefinition) {
  if (!definition.id.trim() || MINIGAMES[definition.id]) throw new Error("A minigame with that ID is already registered");
  MINIGAMES[definition.id] = definition;
}

function createRound(number: number, minigameId: string, now: number): PartyRound {
  return { number, minigameId, startedAt: now, deadlineAt: now + ROUND_SECONDS * 1000, submissions: {}, result: null };
}
function selectWinner(players: Player[], round: PartyRound) {
  return [...players].sort((a, b) => (round.result?.points[b.id] ?? 0) - (round.result?.points[a.id] ?? 0) || players.indexOf(a) - players.indexOf(b))[0]?.id ?? null;
}
function rulePool(session: PartySession, players: Player[]): HouseRule[] {
  return HOUSE_RULES.filter((rule) => rule.canStack || !session.activeRules.some((active) => active.id === rule.id)).map((rule) => {
    if (rule.id === "underdog") return { ...rule, effect: { type: "last-place-bonus", points: 1 } };
    if (rule.id === "double-down") return { ...rule, effect: { type: "score-multiplier", multiplier: 2 } };
    const targetId = players[randomInt(players.length)]?.id ?? "";
    return { ...rule, effect: { type: "bounty", points: 2, targetId } };
  });
}
function chooseOffers(session: PartySession, players: Player[]) {
  const pool = rulePool(session, players);
  for (let i = pool.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  session.offeredRules = pool.slice(0, Math.min(3, pool.length));
}
function resolveRound(room: Room, now: number) {
  const session = room.session;
  const round = session?.round;
  if (!session || !round || round.result || session.phase !== "active-game") return;
  if (Object.keys(round.submissions).length < room.players.length && now < round.deadlineAt) return;
  round.result = MINIGAMES[round.minigameId].resolve({ players: room.players, submissions: round.submissions, scores: session.scores, rules: session.activeRules });
  for (const [playerId, earned] of Object.entries(round.result.points)) session.scores[playerId] = (session.scores[playerId] ?? 0) + earned;
  session.phase = "game-results";
  session.ruleWinnerId = selectWinner(room.players, round);
  session.history.push({ number: round.number, minigameId: round.minigameId, result: structuredClone(round.result), rules: structuredClone(session.activeRules), selectedRule: null });
  chooseOffers(session, room.players);
}

export function join(room: Room, uid: string, name: string, now: number) {
  if (room.blockedPlayers?.includes(uid)) throw new Error("The host removed you from this room");
  const existing = room.players.find((player) => player.id === uid);
  if (existing) { existing.seenAt = now; if (name) existing.name = name; return; }
  if (room.session) throw new Error("This party has already started");
  if (room.players.length >= 8) throw new Error("Room is full");
  room.players.push({ id: uid, name, seenAt: now });
}

export function apply(room: Room, uid: string, action: Action, now: number, actionId: string) {
  const player = room.players.find((candidate) => candidate.id === uid);
  if (!player) throw new Error("Not a room member");
  if (room.processed.includes(actionId)) { player.seenAt = now; return; }
  player.seenAt = now;
  resolveRound(room, now);
  const session = room.session;
  switch (action.type) {
    case "sync": break;
    case "start": {
      if (uid !== room.hostId) throw new Error("Only the host can start the party");
      if (room.session) throw new Error("This party has already started");
      if (room.players.length < 2) throw new Error("At least two players are required to start");
      if (room.players.some((p) => now - p.seenAt > 15000)) throw new Error("All players must be connected before starting");
      room.session = { phase: "game-intro", gameNumber: 1, gameSlots: Array.from({ length: SESSION_GAME_COUNT }, () => splitDecision.id), scores: Object.fromEntries(room.players.map((p) => [p.id, 0])), round: null, activeRules: [], offeredRules: [], newlyActivatedRule: null, ruleWinnerId: null, history: [] };
      break;
    }
    case "continue-session": {
      if (uid !== room.hostId) throw new Error("Only the host can continue the party");
      if (!session || session.phase !== "intermission") throw new Error("The party is not at an intermission");
      if (session.gameNumber >= session.gameSlots.length) { session.phase = "final-results"; break; }
      session.gameNumber++;
      session.phase = "game-intro";
      session.round = null;
      session.ruleWinnerId = null;
      break;
    }
    case "begin-game": {
      if (uid !== room.hostId) throw new Error("Only the host can begin the game");
      if (!session || session.phase !== "game-intro") throw new Error("The party is not ready to begin a game");
      const minigameId = session.gameSlots[session.gameNumber - 1];
      if (!MINIGAMES[minigameId]) throw new Error("This game is not registered");
      session.phase = "active-game";
      session.newlyActivatedRule = null;
      session.round = createRound(session.gameNumber, minigameId, now);
      break;
    }
    case "submit": {
      if (!session || session.phase !== "active-game" || !session.round) throw new Error("This game is not accepting choices");
      if (now >= session.round.deadlineAt) { resolveRound(room, now); throw new Error("Time is up for this game"); }
      if (session.round.submissions[uid]) throw new Error("Your choice is already locked in");
      if (action.value !== "RED" && action.value !== "BLUE") throw new Error("Choose RED or BLUE");
      session.round.submissions[uid] = action.value;
      resolveRound(room, now);
      break;
    }
    case "select-rule": {
      if (!session || session.phase !== "house-rule-selection") throw new Error("There is no House Rule to choose right now");
      if (uid !== session.ruleWinnerId) throw new Error("Only this game's winner can choose the House Rule");
      const rule = session.offeredRules.find((offer) => offer.id === action.value);
      if (!rule) throw new Error("Choose one of the House Rule cards shown");
      if (!rule.canStack) session.activeRules = session.activeRules.filter((active) => active.id !== rule.id);
      session.activeRules.push(structuredClone(rule));
      session.newlyActivatedRule = structuredClone(rule);
      session.offeredRules = [];
      const last = session.history.at(-1);
      if (last) last.selectedRule = structuredClone(rule);
      session.phase = "intermission";
      break;
    }
    case "open-rule-selection": {
      if (!session || session.phase !== "game-results" || uid !== session.ruleWinnerId) throw new Error("Only this game's winner can choose the House Rule");
      session.phase = "house-rule-selection";
      break;
    }
    default: throw new Error("Unknown action");
  }
  room.processed = [...room.processed.slice(-255), actionId];
}

export function snapshot(room: Room, uid: string, now: number): Snapshot {
  if (!room.players.some((player) => player.id === uid)) throw new Error("Not a room member");
  resolveRound(room, now);
  const session = room.session;
  return {
    id: room.id, code: room.code, hostId: room.hostId, revision: room.revision, players: room.players.map((player) => ({ ...player })), me: uid, serverNow: now,
    session: session ? { ...structuredClone(session), round: session.round ? {
      number: session.round.number, minigameId: session.round.minigameId, startedAt: session.round.startedAt, deadlineAt: session.round.deadlineAt,
      result: session.round.result ? structuredClone(session.round.result) : null, answeredCount: Object.keys(session.round.submissions).length,
      myChoice: session.round.submissions[uid] ?? null, submittedIds: session.phase === "active-game" ? Object.keys(session.round.submissions) : [],
    } : null } : null,
  };
}
