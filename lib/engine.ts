import { randomInt } from "node:crypto";
import type { Action, HouseRule, MinigameResolution, PartyRound, PartySession, Player, Room, Snapshot } from "./types";
import { MINIGAMES, resolveAwards, registerMinigame } from "./games";

const ROUND_SECONDS = 45;
export const SESSION_GAME_COUNT = 6;
export const DEFAULT_GAME_SLOTS = ["split-decision", "make-it-worse", "trust-me", "split-decision", "pile-on", "make-it-worse"] as const;
export { MINIGAMES, registerMinigame };
export const HOUSE_RULES: Omit<HouseRule, "effect">[] = [
  { id: "underdog", name: "Underdog", description: "The player in last place earns bonus points whenever they score.", activationPoint: "next-game", canStack: false },
  { id: "bounty", name: "Bounty", description: "Outscore the marked player's base points to earn a bonus.", activationPoint: "next-game", canStack: false },
  { id: "double-down", name: "Double Down", description: "Double points scored in each later game.", activationPoint: "next-game", canStack: true },
];

function createRound(number: number, minigameId: string, config: PartyRound["config"], now: number): PartyRound {
  return { number, minigameId, startedAt: now, deadlineAt: now + ROUND_SECONDS * 1000, config: structuredClone(config), submissions: {}, result: null };
}
function selectWinner(players: Player[], round: PartyRound) {
  return [...players].sort((a, b) => (round.result?.points[b.id] ?? 0) - (round.result?.points[a.id] ?? 0) || players.indexOf(a) - players.indexOf(b))[0]?.id ?? null;
}
function rulePool(session: PartySession, players: Player[]): HouseRule[] {
  return HOUSE_RULES.filter((rule) => rule.canStack || !session.activeRules.some((active) => active.id === rule.id)).map((rule) => {
    if (rule.id === "underdog") return { ...rule, effect: { type: "last-place-bonus", points: 1 } };
    if (rule.id === "double-down") return { ...rule, effect: { type: "score-multiplier", multiplier: 2 } };
    return { ...rule, effect: { type: "bounty", points: 2, targetId: players[randomInt(players.length)]?.id ?? "" } };
  });
}
function chooseOffers(session: PartySession, players: Player[]) {
  const pool = rulePool(session, players);
  for (let i = pool.length - 1; i > 0; i--) { const j = randomInt(i + 1); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  session.offeredRules = pool.slice(0, Math.min(3, pool.length));
}
function applyHouseRules(players: Player[], scores: Record<string, number>, rules: HouseRule[], game: Omit<MinigameResolution, "points" | "modifiers" | "optionCounts">, optionCounts: Record<string, number>): MinigameResolution {
  const points: Record<string, number> = {};
  const modifiers: Record<string, string[]> = Object.fromEntries(players.map((player) => [player.id, []]));
  const multiplier = rules.reduce((total, rule) => rule.effect.type === "score-multiplier" ? total * rule.effect.multiplier : total, 1);
  for (const player of players) {
    const raw = game.basePoints[player.id] ?? 0;
    points[player.id] = raw * multiplier;
    if (raw && multiplier !== 1) modifiers[player.id].push(`Double Down ×${multiplier}: ${raw} → ${points[player.id]}`);
  }
  const bountyBase = { ...points };
  const lowest = Math.min(...players.map((player) => scores[player.id] ?? 0));
  const underdogIds = new Set(players.filter((player) => (scores[player.id] ?? 0) === lowest).map((player) => player.id));
  for (const rule of rules) if (rule.effect.type === "last-place-bonus") for (const player of players) {
    if (underdogIds.has(player.id) && (game.basePoints[player.id] ?? 0) > 0) {
      points[player.id] += rule.effect.points;
      modifiers[player.id].push(`Underdog +${rule.effect.points}`);
    }
  }
  for (const rule of rules) if (rule.effect.type === "bounty") {
    const target = bountyBase[rule.effect.targetId];
    if (target !== undefined) for (const player of players) if (player.id !== rule.effect.targetId && bountyBase[player.id] > target) {
      points[player.id] += rule.effect.points;
      modifiers[player.id].push(`Bounty +${rule.effect.points}`);
    }
  }
  const reasons = Object.fromEntries(players.map((player) => {
    const gameReason = game.reasons[player.id] ?? "No pick before time ran out.";
    const modifierText = modifiers[player.id].length ? ` ${modifiers[player.id].join(" · ")}.` : "";
    return [player.id, `${gameReason}${modifierText}`];
  }));
  return { ...structuredClone(game), points, reasons, modifiers, optionCounts };
}

function resolveRound(room: Room, now: number) {
  const session = room.session;
  const round = session?.round;
  if (!session || !round || round.result || session.phase !== "active-game") return;
  if (Object.keys(round.submissions).length < room.players.length && now < round.deadlineAt) return;
  const definition = MINIGAMES[round.minigameId];
  const resolution = definition.resolve({ players: room.players, submissions: round.submissions, scores: session.scores, config: round.config });
  const counts = Object.fromEntries(round.config.options.map(({ id }) => [id, Object.values(round.submissions).filter((choice) => choice === id).length]));
  round.result = applyHouseRules(room.players, session.scores, session.activeRules, resolution, counts);
  for (const [playerId, earned] of Object.entries(round.result.points)) session.scores[playerId] = Math.max(0, (session.scores[playerId] ?? 0) + earned);
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
      const gameSlots = [...DEFAULT_GAME_SLOTS];
      const firstGame = MINIGAMES[gameSlots[0]];
      room.session = { phase: "game-intro", gameNumber: 1, gameSlots, gameConfig: firstGame.config({ players: room.players, gameNumber: 1 }), scores: Object.fromEntries(room.players.map((p) => [p.id, 0])), round: null, activeRules: [], offeredRules: [], newlyActivatedRule: null, ruleWinnerId: null, history: [], awards: [] };
      break;
    }
    case "continue-session": {
      if (uid !== room.hostId) throw new Error("Only the host can continue the party");
      if (!session || session.phase !== "intermission") throw new Error("The party is not at an intermission");
      if (session.gameNumber >= session.gameSlots.length) { session.awards = resolveAwards(session.history, room.players); session.phase = "final-results"; break; }
      session.gameNumber++;
      session.gameConfig = MINIGAMES[session.gameSlots[session.gameNumber - 1]].config({ players: room.players, gameNumber: session.gameNumber });
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
      session.round = createRound(session.gameNumber, minigameId, session.gameConfig, now);
      break;
    }
    case "submit": {
      if (!session || session.phase !== "active-game" || !session.round) throw new Error("This game is not accepting choices");
      if (now >= session.round.deadlineAt) { resolveRound(room, now); throw new Error("Time is up for this game"); }
      if (Object.hasOwn(session.round.submissions, uid)) throw new Error("Your choice is already locked in");
      if (typeof action.value !== "string" || !MINIGAMES[session.round.minigameId].validate(action.value, { players: room.players, playerId: uid, config: session.round.config })) throw new Error("Choose one of the options shown");
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
      number: session.round.number, minigameId: session.round.minigameId, startedAt: session.round.startedAt, deadlineAt: session.round.deadlineAt, config: structuredClone(session.round.config),
      result: session.round.result ? structuredClone(session.round.result) : null, answeredCount: Object.keys(session.round.submissions).length,
      myChoice: session.round.submissions[uid] ?? null, submittedIds: session.phase === "active-game" ? Object.keys(session.round.submissions) : [],
    } : null } : null,
  };
}
