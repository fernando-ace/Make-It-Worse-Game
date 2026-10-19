import { randomBytes } from "node:crypto";
import type { Action, ChaosIntensity, HouseRule, MinigameResolution, PartyRound, PartySession, Player, Room, Snapshot } from "./types";
import { MINIGAMES, resolveAwards, registerMinigame } from "./games";
import { assignObjectives, advanceObjectives } from "./objectives";
import { POWERS, powerOffersFor } from "./powers";
import { seededShuffle } from "./seed";
import { directSessionGames } from "./director";

const ROUND_SECONDS = 45;
export const SESSION_GAME_COUNT = 6;
export { MINIGAMES, registerMinigame };
export { OBJECTIVES } from "./objectives";
export { POWER_LIST } from "./powers";
export { GAME_DIRECTOR_METADATA, directSessionGames } from "./director";
type HouseRuleDefinition = Omit<HouseRule, "effect"> & { compatibleFamilies: string[] };
export const HOUSE_RULES: HouseRuleDefinition[] = [
  { id: "binding-promises", name: "Your Word Matters", description: "Kept route or venue promises earn +2; broken promises cost 1. Applies after multipliers.", activationPoint: "next-game", canStack: false, compatibleFamilies: ["public-commitment", "resource-allocation"] },
  { id: "breathing-room", name: "Talk It Out", description: "Add 15 seconds to each decision in two-beat games. Make a deal before locking.", activationPoint: "next-game", canStack: false, compatibleFamilies: ["public-commitment", "resource-allocation", "asymmetric-report", "sequential-pressure"] },
  { id: "underdog", name: "Underdog", description: "The player in last place earns +1 when they score.", activationPoint: "next-game", canStack: false, compatibleFamilies: ["*"] },
  { id: "bounty", name: "Bounty", description: "Outscore the marked player's base points to earn +2.", activationPoint: "next-game", canStack: false, compatibleFamilies: ["*"] },
  { id: "double-down", name: "Double Down", description: "Double points scored in each later game, stacking up to ×4.", activationPoint: "next-game", canStack: true, compatibleFamilies: ["*"] },
  { id: "first-commit", name: "First on the Record", description: "The marked player must lock in before everyone else.", activationPoint: "next-game", canStack: false, compatibleFamilies: ["*"] },
  { id: "safety-net", name: "Soft Landing", description: "The marked player cannot lose points in later games.", activationPoint: "next-game", canStack: false, compatibleFamilies: ["*"] },
  { id: "target-bonus", name: "Pick a Side", description: "Targeted moves earn +1 each. Passes and callouts count.", activationPoint: "next-game", canStack: false, compatibleFamilies: ["targeting", "passing-risk"] },
  { id: "alliance-bonus", name: "Better Together", description: "Each mutual pact earns both friends +1.", activationPoint: "next-game", canStack: false, compatibleFamilies: ["alliance"] },
  { id: "chaos-bonus", name: "Chaos Dividend", description: "Moves marked as chaos earn an extra +1.", activationPoint: "next-game", canStack: false, compatibleFamilies: ["*"] },
  { id: "failed-risk-cost", name: "Bad Bet Fee", description: "Each failed recorded gamble costs an extra point.", activationPoint: "next-game", canStack: false, compatibleFamilies: ["risk", "auction", "trust"] },
  { id: "protection-bonus", name: "Guardian Angel", description: "A successful save or golden-ticket vote earns the pair +1 each.", activationPoint: "next-game", canStack: false, compatibleFamilies: ["protection-vote", "popularity-vote"] },
  { id: "cooperation-bonus", name: "Team Credit", description: "A successful group-project contribution earns +1.", activationPoint: "next-game", canStack: false, compatibleFamilies: ["shared-effort"] },
];

export { powerOffersFor } from "./powers";

export function selectSessionGames(seed: string): string[] {
  return directSessionGames(seed, MINIGAMES);
}

function createRound(number: number, minigameId: string, config: PartyRound["config"], now: number, rules: HouseRule[], players: Player[]): PartyRound {
  const firstCommit = rules.find((rule) => rule.effect.type === "forced-first");
  const preferredId = firstCommit?.effect.type === "forced-first" ? firstCommit.effect.playerId : null;
  const firstCommitPlayerId = preferredId && players.some((player) => player.id === preferredId) ? preferredId : null;
  const beats = MINIGAMES[minigameId].multiBeat;
  return { ...(beats ? { beat: { index: 0 as const, firstChoices: {}, publicLines: [], privateHints: {} } } : {}), number, minigameId, openedAt: now, startedAt: now, deadlineAt: now + ((beats?.seconds[0] ?? ROUND_SECONDS) + (beats && rules.some(rule => rule.effect.type === "breathing-room") ? 15 : 0)) * 1000, config: structuredClone(config), submissions: {}, firstCommitPlayerId, result: null };
}
function createSession(room: Room, seed = randomBytes(16).toString("hex"), avoidSlots?: string[], chaosIntensity: ChaosIntensity = "standard", now = Date.now()): PartySession {
  let attempt = 0;
  let selectedSeed = seed;
  let gameSlots = directSessionGames(selectedSeed, MINIGAMES, room.players.length);
  while (avoidSlots && gameSlots.join("|") === avoidSlots.join("|") && attempt < 8) {
    selectedSeed = `${seed}:runback:${++attempt}`;
    gameSlots = directSessionGames(selectedSeed, MINIGAMES, room.players.length);
  }
  const firstGame = MINIGAMES[gameSlots[0]];
  return {
    phase: "game-intro", startedAt: now, gameNumber: 1, gameSlots, seed: selectedSeed, chaosIntensity,
    objectives: assignObjectives(selectedSeed, room.players, gameSlots),
    objectivesRevealedBy: [],
    chaos: Object.fromEntries(room.players.map((player) => [player.id, chaosIntensity === "high" ? 3 : 2])), activePowers: [], scoreProgression: [Object.fromEntries(room.players.map((player) => [player.id, 0]))],
    gameConfig: firstGame.config({ players: room.players, gameNumber: 1 }),
    scores: Object.fromEntries(room.players.map((player) => [player.id, 0])), round: null,
    activeRules: [], offeredRules: [], newlyActivatedRule: null, ruleWinnerId: null, history: [], awards: [],
  };
}

function hydrateSession(room: Room) {
  const session = room.session;
  if (!session) return;
  if (!session.startedAt) session.startedAt = room.createdAt;
  if (!session.seed) session.seed = `${room.id}:legacy-session`;
  if (!session.objectives) session.objectives = assignObjectives(session.seed, room.players, session.gameSlots);
  if (!session.objectivesRevealedBy) session.objectivesRevealedBy = [];
  if (!session.chaos) session.chaos = Object.fromEntries(room.players.map((player) => [player.id, 2]));
  if (!session.activePowers) session.activePowers = [];
  if (!session.scores) session.scores = Object.fromEntries(room.players.map(player => [player.id, 0]));
  if (!session.activeRules) session.activeRules = [];
  if (!session.offeredRules) session.offeredRules = [];
  if (!session.history) session.history = [];
  if (!session.awards) session.awards = [];
  if (!session.gameNumber) session.gameNumber = 1;
  if (!session.scoreProgression) session.scoreProgression = [Object.fromEntries(room.players.map((player) => [player.id, 0]))];
}
function selectWinner(players: Player[], round: PartyRound) {
  return [...players].sort((a, b) => (round.result?.points[b.id] ?? 0) - (round.result?.points[a.id] ?? 0) || players.indexOf(a) - players.indexOf(b))[0]?.id ?? null;
}
function rulePool(session: PartySession, players: Player[]): HouseRule[] {
  const futureFamilies = new Set(session.gameSlots.slice(session.gameNumber).map((id) => MINIGAMES[id]?.director?.family).filter((family): family is string => Boolean(family)));
  return HOUSE_RULES.filter((rule) => (rule.compatibleFamilies.includes("*") || rule.compatibleFamilies.some((family) => futureFamilies.has(family))) && (rule.id === "double-down"
    ? session.activeRules.filter((active) => active.id === rule.id).length < 2
    : rule.canStack || !session.activeRules.some((active) => active.id === rule.id))).map((rule) => {
    if (rule.id === "binding-promises") return { ...rule, effect: { type: "binding-promises" } };
    if (rule.id === "breathing-room") return { ...rule, effect: { type: "breathing-room" } };
    if (rule.id === "underdog") return { ...rule, effect: { type: "last-place-bonus", points: 1 } };
    if (rule.id === "double-down") return { ...rule, effect: { type: "score-multiplier", multiplier: 2 } };
    if (rule.id === "first-commit") return { ...rule, effect: { type: "forced-first", playerId: players[0]?.id ?? "" } };
    if (rule.id === "safety-net") return { ...rule, effect: { type: "score-floor", playerId: players[0]?.id ?? "" } };
    if (rule.id === "bounty") return { ...rule, effect: { type: "bounty", points: 2, targetId: players[0]?.id ?? "" } };
    if (rule.id === "target-bonus") return { ...rule, effect: { type: "target-bonus", points: 1 } };
    if (rule.id === "alliance-bonus") return { ...rule, effect: { type: "alliance-bonus", points: 1 } };
    if (rule.id === "chaos-bonus") return { ...rule, effect: { type: "chaos-bonus", points: 1 } };
    if (rule.id === "failed-risk-cost") return { ...rule, effect: { type: "failed-risk-cost", points: 1 } };
    if (rule.id === "protection-bonus") return { ...rule, effect: { type: "protection-bonus", points: 1 } };
    return { ...rule, effect: { type: "cooperation-bonus", points: 1 } };
  });
}
function chooseOffers(session: PartySession, players: Player[]) {
  const pool = seededShuffle(rulePool(session, players).map((rule) => {
    const target = seededShuffle(players, `${session.seed}:rule-target:${session.gameNumber}:${rule.id}`)[0]?.id ?? "";
    if (rule.effect.type === "forced-first" || rule.effect.type === "score-floor") return { ...rule, effect: { ...rule.effect, playerId: target } };
    if (rule.effect.type === "bounty") return { ...rule, effect: { ...rule.effect, targetId: target } };
    return rule;
  }), `${session.seed}:offers:${session.gameNumber}`);
  session.offeredRules = pool.slice(0, 4);
}
function applyHouseRules(players: Player[], scores: Record<string, number>, rules: HouseRule[], game: Omit<MinigameResolution, "points" | "modifiers" | "optionCounts">, optionCounts: Record<string, number>, gameNumber = 1, powers: PartySession["activePowers"] = []): MinigameResolution {
  const points: Record<string, number> = {};
  const modifiers: Record<string, string[]> = Object.fromEntries(players.map((player) => [player.id, []]));
  const multiplier = rules.reduce((total, rule) => rule.effect.type === "score-multiplier" ? Math.min(4, total * rule.effect.multiplier) : total, 1);
  for (const player of players) {
    const original = game.basePoints[player.id] ?? 0;
    const protectedPlayer = rules.some((rule) => rule.effect.type === "score-floor" && rule.effect.playerId === player.id);
    const raw = protectedPlayer ? Math.max(0, original) : original;
    points[player.id] = raw * multiplier;
    if (protectedPlayer && original < 0) modifiers[player.id].push(`Soft Landing +${Math.abs(original)}`);
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
  for (const rule of rules) {
    const effect = rule.effect;
    if (effect.type === "binding-promises") for (const event of game.events) if (event.type === "promise") {
      const amount = event.kept ? 2 : -1;
      points[event.playerId] += amount;
      modifiers[event.playerId].push(`Your Word Matters ${amount > 0 ? "+" : ""}${amount}`);
    }
    if (effect.type === "target-bonus") for (const event of game.events) if (event.type === "target" && points[event.actorId] !== undefined) {
      points[event.actorId] += effect.points;
      modifiers[event.actorId].push(`Pick a Side +${effect.points}`);
    }
    if (effect.type === "alliance-bonus") {
      const pairs = new Set(game.events.flatMap((event) => event.type === "alliance" && event.mutual && event.playerId < event.targetId ? [`${event.playerId}|${event.targetId}`] : []));
      for (const pair of pairs) for (const playerId of pair.split("|")) if (points[playerId] !== undefined) {
        points[playerId] += effect.points;
        modifiers[playerId].push(`Better Together +${effect.points}`);
      }
    }
    if (effect.type === "chaos-bonus") for (const event of game.events) if (event.type === "chaos" && points[event.playerId] !== undefined) {
      points[event.playerId] += effect.points;
      modifiers[event.playerId].push(`Chaos Dividend +${effect.points}`);
    }
    if (effect.type === "failed-risk-cost") for (const event of game.events) if (event.type === "gamble" && event.result === "lost" && points[event.playerId] !== undefined) {
      points[event.playerId] -= effect.points;
      modifiers[event.playerId].push(`Bad Bet Fee −${effect.points}`);
    }
    if (effect.type === "protection-bonus") for (const event of game.events) if ((event.type === "save" || event.type === "support") && event.successful) {
      for (const playerId of new Set([event.actorId, event.targetId])) if (points[playerId] !== undefined) {
        points[playerId] += effect.points;
        modifiers[playerId].push(`Guardian Angel +${effect.points}`);
      }
    }
    if (effect.type === "cooperation-bonus") for (const event of game.events) if (event.type === "contribution" && event.successful && points[event.playerId] !== undefined) {
      points[event.playerId] += effect.points;
      modifiers[event.playerId].push(`Team Credit +${effect.points}`);
    }
  }
  const beforePowers = { ...points };
  const priority: Record<string, number> = { hex: 0, pickpocket: 1, guard: 2, bodyguard: 2, bounty: 3, amplify: 4, comeback: 4, contrarian: 4, scout: 5 };
  for (const power of [...powers].filter((item) => item.gameNumber === gameNumber).sort((a, b) => (priority[a.id] ?? 9) - (priority[b.id] ?? 9) || a.actorId.localeCompare(b.actorId) || a.id.localeCompare(b.id))) {
    const actor = points[power.actorId];
    if (actor === undefined) continue;
    let outcome: "success" | "miss" | "info" = "miss";
    if (power.id === "guard" && actor < 0) {
      modifiers[power.actorId].push(`Soft Landing power +${Math.abs(actor)}`);
      points[power.actorId] = 0;
      outcome = "success";
    } else if (power.id === "amplify" && actor > 0) {
      points[power.actorId]++;
      modifiers[power.actorId].push("Turn It Up +1");
      outcome = "success";
    } else if (power.id === "bounty" && power.targetId && beforePowers[power.targetId] !== undefined && beforePowers[power.actorId] > beforePowers[power.targetId]) {
      points[power.actorId] += 2;
      modifiers[power.actorId].push(`Side Bet +2 over ${players.find((player) => player.id === power.targetId)?.name ?? "marked player"}`);
      outcome = "success";
    } else if (power.id === "hex" && power.targetId && points[power.targetId] !== undefined) {
      points[power.targetId] -= 2;
      modifiers[power.targetId].push(`Bad Omen −2 from ${players.find((player) => player.id === power.actorId)?.name ?? "a player"}`);
      outcome = "success";
    } else if (power.id === "pickpocket" && power.targetId && points[power.targetId] > 0) {
      points[power.actorId]++;
      points[power.targetId]--;
      modifiers[power.actorId].push("Pocket Change +1 stolen");
      modifiers[power.targetId].push(`Pocket Change −1 to ${players.find((player) => player.id === power.actorId)?.name ?? "a player"}`);
      outcome = "success";
    } else if (power.id === "bodyguard" && power.targetId && points[power.targetId] < 0) {
      modifiers[power.targetId].push(`Take the Hit +${Math.abs(points[power.targetId])}`);
      points[power.targetId] = 0;
      points[power.actorId]++;
      modifiers[power.actorId].push("Take the Hit: successful rescue +1");
      outcome = "success";
    } else if (power.id === "comeback" && actor > 0 && (scores[power.actorId] ?? 0) === Math.min(...players.map((player) => scores[player.id] ?? 0))) {
      points[power.actorId] += 2;
      modifiers[power.actorId].push("Second Wind +2");
      outcome = "success";
    } else if (power.id === "contrarian" && power.actorId in game.choices && optionCounts[game.choices[power.actorId]] === 1) {
      points[power.actorId] += 2;
      modifiers[power.actorId].push("Lone Wolf +2");
      outcome = "success";
    } else if (power.id === "scout") {
      outcome = "info";
    }
    game.events.push({ type: "power", playerId: power.actorId, powerId: power.id, ...(power.targetId ? { targetId: power.targetId } : {}), outcome });
  }
  if (gameNumber === 5) {
    const chaosPlayers = new Set(game.events.flatMap((event) => event.type === "chaos" ? [event.playerId] : []));
    for (const player of players) if (chaosPlayers.has(player.id)) {
      points[player.id] += 1;
      modifiers[player.id].push("Game 5 chaos +1");
    }
  }
  // The finale puts extra points on the round result while preserving the
  // accumulated session score as the final source of truth.
  if (gameNumber === SESSION_GAME_COUNT) {
    const roundLead = Math.max(...players.map((player) => points[player.id] ?? 0));
    if (roundLead > 0) for (const player of players) if (points[player.id] === roundLead) {
      points[player.id] += 3;
      modifiers[player.id].push("Finale round leader +3");
    }
    const lastPlaceScore = Math.min(...players.map((player) => scores[player.id] ?? 0));
    for (const player of players) if ((scores[player.id] ?? 0) === lastPlaceScore && (game.basePoints[player.id] ?? 0) > 0) {
      points[player.id] += 2;
      modifiers[player.id].push("Finale comeback +2");
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
  hydrateSession(room);
  const session = room.session;
  const round = session?.round;
  if (!session || !round || round.result || session.phase !== "active-game") return;
  if (Object.keys(round.submissions).length < room.players.length && now < round.deadlineAt) return;
  const definition = MINIGAMES[round.minigameId];
  if (definition.multiBeat && round.beat?.index === 0) {
    const previousDeadline = round.deadlineAt;
    const next = definition.multiBeat.advance({ players: room.players, submissions: round.submissions, seed: `${session.seed}:${round.number}` });
    round.beat = { index: 1, firstChoices: { ...round.submissions }, publicLines: next.publicLines, privateHints: next.privateHints ?? {} };
    round.submissions = {};
    round.config = next.config;
    // Late sync never grants extra decision time. A timely completion starts beat two now.
    round.startedAt = Math.min(now, previousDeadline);
    round.deadlineAt = round.startedAt + (definition.multiBeat.seconds[1] + (session.activeRules.some(rule => rule.effect.type === "breathing-room") ? 15 : 0)) * 1000;
    if (now >= round.deadlineAt) resolveRound(room, now);
    return;
  }
  const resolution = definition.multiBeat && round.beat
    ? definition.multiBeat.resolve({ players: room.players, submissions: round.submissions, firstChoices: round.beat.firstChoices, seed: `${session.seed}:${round.number}` })
    : definition.resolve({ players: room.players, submissions: round.submissions, scores: session.scores, config: round.config });
  const counts = Object.fromEntries(round.config.options.map(({ id }) => [id, Object.values(round.submissions).filter((choice) => choice === id).length]));
  round.result = applyHouseRules(room.players, session.scores, session.activeRules, resolution, counts, round.number, session.activePowers);
  const highScore = Math.max(...room.players.map((player) => round.result!.points[player.id] ?? 0));
  for (const player of room.players) round.result.events.push({ type: "round-score", playerId: player.id, points: round.result.points[player.id] ?? 0, highest: (round.result.points[player.id] ?? 0) === highScore, gameNumber: round.number });
  for (const [playerId, earned] of Object.entries(round.result.points)) session.scores[playerId] = Math.max(0, (session.scores[playerId] ?? 0) + earned);
  for (const player of room.players) {
    if (!Object.hasOwn(round.submissions, player.id)) continue;
    const earnings = Math.min(8 - (session.chaos[player.id] ?? 0), Math.min(3, 1 + Math.floor(Math.max(0, round.result.points[player.id] ?? 0) / 3)));
    session.chaos[player.id] = Math.min(8, (session.chaos[player.id] ?? 0) + earnings);
    round.result.events.push({ type: "chaos-earned", playerId: player.id, amount: earnings });
  }
  advanceObjectives(session.objectives, round.result.events, round.minigameId);
  session.scoreProgression.push(structuredClone(session.scores));
  session.activePowers = [];
  round.completedAt = now;
  session.phase = "game-results";
  session.ruleWinnerId = selectWinner(room.players, round);
  session.history.push({ number: round.number, minigameId: round.minigameId, result: structuredClone(round.result), rules: structuredClone(session.activeRules), selectedRule: null });
  chooseOffers(session, room.players);
}

function finishSession(room: Room, session: PartySession, now: number) {
  for (const player of room.players) {
    const reserve = Math.min(2, Math.floor((session.chaos[player.id] ?? 0) / 3));
    session.scores[player.id] = (session.scores[player.id] ?? 0) + reserve;
    const objective = session.objectives[player.id];
    if (objective?.completed) session.scores[player.id] = (session.scores[player.id] ?? 0) + objective.reward;
  }
  session.scoreProgression[session.scoreProgression.length - 1] = structuredClone(session.scores);
  session.awards = resolveAwards(session.history, room.players);
  session.completedAt = now;
  session.phase = "final-results";
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
    case "set-chaos-intensity": {
      if (uid !== room.hostId) throw new Error("Only the host can change party settings");
      if (room.session) throw new Error("Party settings are locked after the game starts");
      if (action.value !== "standard" && action.value !== "high") throw new Error("Choose standard or high Chaos intensity");
      room.chaosIntensity = action.value;
      break;
    }
    case "start": {
      if (uid !== room.hostId) throw new Error("Only the host can start the party");
      if (room.session) throw new Error("This party has already started");
      if (room.players.length < 2) throw new Error("At least two players are required to start");
      if (room.players.some((p) => now - p.seenAt > 15000)) throw new Error("All players must be connected before starting");
      room.session = createSession(room, undefined, undefined, room.chaosIntensity ?? "standard", now);
      break;
    }
    case "continue-session": {
      if (uid !== room.hostId) throw new Error("Only the host can continue the party");
      if (!session || session.phase !== "intermission") throw new Error("The party is not at an intermission");
      if (session.gameNumber >= session.gameSlots.length) {
        finishSession(room, session, now);
        break;
      }
      session.gameNumber++;
      session.gameConfig = MINIGAMES[session.gameSlots[session.gameNumber - 1]].config({ players: room.players, gameNumber: session.gameNumber });
      session.phase = "game-intro";
      session.round = null;
      session.ruleWinnerId = null;
      break;
    }
    case "restart-session": {
      if (uid !== room.hostId) throw new Error("Only the host can start a new session");
      if (!session || session.phase !== "final-results") throw new Error("Finish the current session before starting another");
      room.session = createSession(room, randomBytes(16).toString("hex"), session.gameSlots, session.chaosIntensity, now);
      break;
    }
    case "begin-game": {
      if (uid !== room.hostId) throw new Error("Only the host can begin the game");
      if (!session || session.phase !== "game-intro") throw new Error("The party is not ready to begin a game");
      const minigameId = session.gameSlots[session.gameNumber - 1];
      if (!MINIGAMES[minigameId]) throw new Error("This game is not registered");
      session.phase = "active-game";
      session.newlyActivatedRule = null;
      session.round = createRound(session.gameNumber, minigameId, session.gameConfig, now, session.activeRules, room.players);
      break;
    }
    case "submit": {
      if (!session || session.phase !== "active-game" || !session.round) throw new Error("This game is not accepting choices");
      if (session.round.beat && action.beat !== session.round.beat.index) throw new Error("This beat changed. Reconnect and choose again.");
      if (session.round.firstCommitPlayerId && !Object.hasOwn(session.round.submissions, session.round.firstCommitPlayerId) && uid !== session.round.firstCommitPlayerId) throw new Error("The marked player must commit first");
      if (now >= session.round.deadlineAt) { resolveRound(room, now); throw new Error("Time is up for this game"); }
      if (Object.hasOwn(session.round.submissions, uid)) throw new Error("Your choice is already locked in");
      if (typeof action.value !== "string" || !MINIGAMES[session.round.minigameId].validate(action.value, { players: room.players, playerId: uid, config: session.round.config })) throw new Error("Choose one of the options shown");
      session.round.submissions[uid] = action.value;
      resolveRound(room, now);
      break;
    }
    case "use-power": {
      if (!session || session.phase !== "active-game" || !session.round || session.round.result) throw new Error("Powers can only be used during an active game");
      if (session.round.beat && action.beat !== session.round.beat.index) throw new Error("This beat changed. Reconnect and choose again.");
      if (now >= session.round.deadlineAt) throw new Error("Time is up for this game");
      if (typeof action.value !== "string") throw new Error("Choose a power shown");
      const [id, targetId] = action.value.split(":");
      if (!Object.hasOwn(POWERS, id)) throw new Error("Choose a power shown");
      const powerId = id as keyof typeof POWERS;
      const power = POWERS[powerId];
      if (!powerOffersFor(session.seed, session.gameNumber, uid).includes(powerId)) throw new Error("That power is not in your current offer");
      if (Object.hasOwn(session.round.submissions, uid) && !(power.targetableAfterCommit && powerId === "scout")) throw new Error("Your choice is already locked in");
      if (power.targetRequired && (!targetId || targetId === uid || !room.players.some((candidate) => candidate.id === targetId))) throw new Error("Choose another player for this power");
      if (power.targetableAfterCommit && targetId && !Object.hasOwn(session.round.submissions, targetId)) throw new Error("That player has not locked in a choice yet");
      if (!power.targetRequired && targetId) throw new Error("Choose a power shown");
      if (session.activePowers.some((power) => power.actorId === uid && power.gameNumber === session.gameNumber)) throw new Error("You already used a power this game");
      const cost = power.cost;
      if ((session.chaos[uid] ?? 0) < cost) throw new Error("Not enough Chaos. Earn more by playing rounds.");
      session.chaos[uid] -= cost;
      session.activePowers.push({ id: powerId, actorId: uid, ...(targetId ? { targetId } : {}), gameNumber: session.gameNumber, beat: session.round.beat?.index });
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
      if (session.gameNumber >= session.gameSlots.length) throw new Error("The finale has no future game for another House Rule");
      session.phase = "house-rule-selection";
      break;
    }
    case "finish-session": {
      if (!session || session.phase !== "game-results" || session.gameNumber !== session.gameSlots.length) throw new Error("Finish the final game before ending the session");
      if (uid !== room.hostId) throw new Error("Only the host can finish the session");
      finishSession(room, session, now);
      break;
    }
    case "reveal-objectives": {
      if (!session || session.phase !== "final-results") throw new Error("Finish the session before revealing objectives");
      if (!session.objectivesRevealedBy.includes(uid)) session.objectivesRevealedBy.push(uid);
      break;
    }
    default: throw new Error("Unknown action");
  }
  room.processed = [...room.processed.slice(-255), actionId];
}

export function snapshot(room: Room, uid: string, now: number): Snapshot {
  if (!room.players.some((player) => player.id === uid)) throw new Error("Not a room member");
  hydrateSession(room);
  resolveRound(room, now);
  const session = room.session;
  return {
    id: room.id, code: room.code, hostId: room.hostId, revision: room.revision, players: room.players.map((player) => ({ ...player })), me: uid, serverNow: now, chaosIntensity: room.chaosIntensity ?? "standard",
    session: session ? (() => {
      const publicSession = structuredClone(session);
      const myObjective = structuredClone(publicSession.objectives[uid]);
      const myChaos = publicSession.chaos[uid] ?? 0;
      const myPowers = publicSession.activePowers.filter((power) => power.actorId === uid);
      const myPowerOffers = powerOffersFor(session.seed, session.gameNumber, uid);
      const scout = session.phase === "active-game" ? session.activePowers.find((power) => power.actorId === uid && power.id === "scout") : undefined;
      const scoutedChoice = scout?.targetId && session.round
        ? scout.beat === session.round.beat?.index ? session.round.submissions[scout.targetId]
          : scout.beat === 0 && session.round.beat?.index === 1 ? session.round.beat.firstChoices[scout.targetId] : undefined
        : undefined;
      const myIntel = scout?.targetId && scoutedChoice ? { playerId: scout.targetId, playerName: room.players.find((player) => player.id === scout.targetId)?.name ?? "Player", choice: scoutedChoice } : null;
      const objectiveReveal = session.phase === "final-results" && session.objectivesRevealedBy.includes(uid) ? structuredClone(publicSession.objectives) : undefined;
      delete (publicSession as unknown as Record<string, unknown>).seed;
      delete (publicSession as unknown as Record<string, unknown>).objectives;
      delete (publicSession as unknown as Record<string, unknown>).chaos;
      delete (publicSession as unknown as Record<string, unknown>).activePowers;
      delete (publicSession as unknown as Record<string, unknown>).objectivesRevealedBy;
      return { ...publicSession, myObjective, myChaos, myPowers, myPowerOffers, myIntel, ...(objectiveReveal ? { objectiveReveal } : {}), round: session.round ? {
      ...(session.round.beat ? { beat: { index: session.round.beat.index, publicLines: [...session.round.beat.publicLines], myFirstChoice: session.round.beat.firstChoices[uid] ?? null, myHint: session.round.beat.privateHints[uid] ?? null } } : {}),
      number: session.round.number, minigameId: session.round.minigameId, startedAt: session.round.startedAt, deadlineAt: session.round.deadlineAt, config: structuredClone(session.round.config),
      firstCommitPlayerId: session.round.firstCommitPlayerId, result: session.round.result ? structuredClone(session.round.result) : null, answeredCount: Object.keys(session.round.submissions).length,
      myChoice: session.round.submissions[uid] ?? null, submittedIds: session.phase === "active-game" ? Object.keys(session.round.submissions) : [],
      } : null };
    })() : null,
  };
}
