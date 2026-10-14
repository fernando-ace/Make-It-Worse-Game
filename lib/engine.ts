import { randomInt } from "node:crypto";
import type { Action, HouseRule, MinigameDefinition, PartyRound, PartySession, Player, Room, Snapshot } from "./types";

const ROUND_SECONDS = 30;
export const HOUSE_RULES: HouseRule[] = [
  { id: "underdog", name: "Underdog", description: "The player in last place earns +1 point next round.", duration: "next-round" },
  { id: "bounty", name: "Bounty", description: "Beat the marked player's base score next round to earn +2 points.", duration: "next-round" },
  { id: "double-down", name: "Double Down", description: "Double the points scored next round.", duration: "next-round" },
];

export const splitDecision: MinigameDefinition = {
  id: "split-decision",
  displayName: "Split Decision",
  instructions: "Choose RED or BLUE in secret. Players in the minority score 2 points. If both colors tie, everyone scores 1 point.",
  phases: ["round-intro", "minigame", "round-results"],
  input: { choices: ["RED", "BLUE"] },
  compatibleHouseRules: HOUSE_RULES.map((rule) => rule.id),
  resolve({ players, submissions, scores, rules }) {
    const redCount = Object.values(submissions).filter((choice) => choice === "RED").length;
    const blueCount = Object.values(submissions).filter((choice) => choice === "BLUE").length;
    const tied = redCount === blueCount;
    const lastPlace = players.reduce<string | null>((last, player) =>
      last === null || (scores[player.id] ?? 0) < (scores[last] ?? 0) ? player.id : last, null);
    const bountyId = rules.find((rule) => rule.id === "bounty")?.parameters?.playerId;
    const base: Record<string, number> = {};
    const points: Record<string, number> = {};
    const reasons: Record<string, string> = {};
    for (const player of players) {
      const choice = submissions[player.id];
      const minority = !tied && ((choice === "RED" && redCount < blueCount) || (choice === "BLUE" && blueCount < redCount));
      const raw = !choice ? 0 : tied ? 1 : minority ? 2 : 0;
      const doubled = rules.some((rule) => rule.id === "double-down");
      base[player.id] = raw * (doubled ? 2 : 1);
      points[player.id] = base[player.id];
      if (!choice) reasons[player.id] = "No choice before time ran out: 0 points.";
      else if (tied) reasons[player.id] = `Color tie: +${base[player.id]} point${base[player.id] === 1 ? "" : "s"} to each player who chose a color.`;
      else if (minority) reasons[player.id] = doubled ? "Minority choice: 2 points, doubled to 4." : "Minority choice: +2 points.";
      else reasons[player.id] = "Majority choice: no points this round.";
      if (rules.some((rule) => rule.id === "underdog") && player.id === lastPlace && raw > 0) {
        points[player.id] += 1;
        reasons[player.id] += " Underdog bonus: +1.";
      }
    }
    if (typeof bountyId === "string" && submissions[bountyId]) {
      for (const player of players) {
        if (player.id !== bountyId && base[player.id] > base[bountyId]) {
          points[player.id] += 2;
          reasons[player.id] += " Bounty bonus: +2 for beating the marked player's base score.";
        }
      }
    }
    return { choices: submissions as Record<string, "RED" | "BLUE">, points, reasons, redCount, blueCount };
  },
};

export const MINIGAMES: Record<string, MinigameDefinition> = { [splitDecision.id]: splitDecision };

function createRound(number: number, now: number): PartyRound {
  return { number, minigameId: "split-decision", startedAt: now, deadlineAt: now + ROUND_SECONDS * 1000, submissions: {}, result: null };
}

function selectWinner(players: Player[], round: PartyRound) {
  return [...players].sort((a, b) => (round.result?.points[b.id] ?? 0) - (round.result?.points[a.id] ?? 0) || players.indexOf(a) - players.indexOf(b))[0]?.id ?? null;
}

function chooseOffers(session: PartySession, players: Player[]) {
  const pool = HOUSE_RULES.filter((rule) => !session.activeRules.some((active) => active.id === rule.id));
  const options = pool.length ? pool : HOUSE_RULES;
  const bountyId = options.some((rule) => rule.id === "bounty") ? players[randomInt(players.length)]?.id : undefined;
  const shuffled = [...options];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  session.offeredRules = shuffled.slice(0, Math.min(3, shuffled.length)).map((rule) => ({
    ...rule,
    ...(rule.id === "bounty" && bountyId ? { parameters: { playerId: bountyId } } : {}),
  }));
}

function resolveRound(room: Room, now: number) {
  const session = room.session;
  const round = session?.round;
  if (!session || !round || round.result || session.phase !== "minigame") return;
  if (Object.keys(round.submissions).length < room.players.length && now < round.deadlineAt) return;
  const definition = MINIGAMES[round.minigameId];
  const rules = session.activeRules;
  round.result = definition.resolve({ players: room.players, submissions: round.submissions, scores: session.scores, rules });
  for (const [playerId, earned] of Object.entries(round.result.points)) session.scores[playerId] = (session.scores[playerId] ?? 0) + earned;
  session.phase = "round-results";
  session.ruleWinnerId = selectWinner(room.players, round);
  session.history.push({ number: round.number, result: structuredClone(round.result), rule: rules[0] ?? null });
  session.activeRules = [];
  if (round.number >= session.maxRounds) session.phase = "final-results";
  else {
    chooseOffers(session, room.players);
  }
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
      if (room.players.length < 2) throw new Error("At least two players are required to start");
      if (room.players.some((p) => now - p.seenAt > 15000)) throw new Error("All players must be connected before starting");
      room.session = { phase: "round-intro", roundNumber: 1, scores: Object.fromEntries(room.players.map((p) => [p.id, 0])), round: null, activeRules: [], offeredRules: [], ruleWinnerId: null, history: [], maxRounds: 2 };
      break;
    }
    case "begin-round": {
      if (uid !== room.hostId) throw new Error("Only the host can begin the round");
      if (!session || !["round-intro", "next-round"].includes(session.phase)) throw new Error("The party is not ready to begin a round");
      if (session.phase === "next-round") session.roundNumber++;
      session.phase = "minigame";
      session.round = createRound(session.roundNumber, now);
      break;
    }
    case "submit": {
      if (!session || session.phase !== "minigame" || !session.round) throw new Error("This round is not accepting choices");
      if (now >= session.round.deadlineAt) { resolveRound(room, now); throw new Error("Time is up for this round"); }
      if (session.round.submissions[uid]) throw new Error("Your choice is already locked in");
      if (action.value !== "RED" && action.value !== "BLUE") throw new Error("Choose RED or BLUE");
      session.round.submissions[uid] = action.value;
      resolveRound(room, now);
      break;
    }
    case "select-rule": {
      if (!session || session.phase !== "house-rule-selection") throw new Error("There is no House Rule to choose right now");
      if (uid !== session.ruleWinnerId) throw new Error("Only this round's winner can choose the House Rule");
      const rule = session.offeredRules.find((offer) => offer.id === action.value);
      if (!rule) throw new Error("Choose one of the House Rule cards shown");
      session.activeRules = [structuredClone(rule)];
      session.offeredRules = [];
      session.phase = "next-round";
      break;
    }
    case "open-rule-selection": {
      if (!session || session.phase !== "round-results" || uid !== session.ruleWinnerId) throw new Error("Only this round's winner can choose the House Rule");
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
    id: room.id, code: room.code, hostId: room.hostId, revision: room.revision,
    players: room.players.map((player) => ({ ...player })), me: uid, serverNow: now,
    session: session ? {
      ...structuredClone(session),
      round: session.round ? {
        number: session.round.number, minigameId: session.round.minigameId,
        startedAt: session.round.startedAt, deadlineAt: session.round.deadlineAt,
        result: session.round.result ? structuredClone(session.round.result) : null,
        answeredCount: Object.keys(session.round.submissions).length,
        myChoice: session.round.submissions[uid] ?? null,
        submittedIds: session.phase === "minigame" ? Object.keys(session.round.submissions) : [],
      } : null,
    } : null,
  };
}
