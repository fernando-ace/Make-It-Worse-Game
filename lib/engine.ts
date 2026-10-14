import { randomBytes } from "node:crypto";
import type { Action, HouseRule, MinigameResolution, PartyRound, PartySession, Player, Room, Snapshot } from "./types";
import { MINIGAMES, resolveAwards, registerMinigame } from "./games";
import { assignObjectives, advanceObjectives } from "./objectives";
import { POWERS } from "./powers";
import { seededShuffle } from "./seed";

const ROUND_SECONDS = 45;
export const SESSION_GAME_COUNT = 6;
export { MINIGAMES, registerMinigame };
export { OBJECTIVES } from "./objectives";
export { POWER_LIST } from "./powers";
export const HOUSE_RULES: Omit<HouseRule, "effect">[] = [
  { id: "underdog", name: "Underdog", description: "The player in last place earns bonus points whenever they score.", activationPoint: "next-game", canStack: false },
  { id: "bounty", name: "Bounty", description: "Outscore the marked player's base points to earn a bonus.", activationPoint: "next-game", canStack: false },
  { id: "double-down", name: "Double Down", description: "Double points scored in each later game, stacking up to ×4.", activationPoint: "next-game", canStack: true },
  { id: "first-commit", name: "First on the Record", description: "The marked player must lock in before everyone else.", activationPoint: "next-game", canStack: false },
  { id: "safety-net", name: "Soft Landing", description: "The marked player cannot lose points in later games.", activationPoint: "next-game", canStack: false },
];

export function selectSessionGames(seed: string): string[] {
  const ids = Object.keys(MINIGAMES).sort();
  if (ids.length < SESSION_GAME_COUNT) throw new Error(`At least ${SESSION_GAME_COUNT} minigames must be registered`);
  const shuffled = seededShuffle(ids, seed);
  const selected: string[] = [];
  const pushBest = (candidates: string[], preferNewInteraction: boolean, maxDifficulty?: number) => {
    const options = candidates.filter((id) => !selected.includes(id) && (maxDifficulty === undefined || (MINIGAMES[id].difficulty ?? 2) <= maxDifficulty));
    const best = options.find((id) => !preferNewInteraction || !selected.length || MINIGAMES[id].interaction !== MINIGAMES[selected.at(-1)!].interaction) ?? options[0];
    if (best) selected.push(best);
  };
  pushBest(shuffled.filter((id) => (MINIGAMES[id].difficulty ?? 2) === 1), false, 1);
  const expansionGames = shuffled.filter((id) => MINIGAMES[id].expansion);
  const readGames = shuffled.filter((id) => MINIGAMES[id].interaction === "read");
  while (selected.length < SESSION_GAME_COUNT - 1 && (selected.filter((id) => MINIGAMES[id].expansion).length < 2 || selected.filter((id) => MINIGAMES[id].interaction === "read").length < 2)) {
    const lastInteraction = selected.at(-1) ? MINIGAMES[selected.at(-1)!].interaction : undefined;
    const hasTwoReads = selected.filter((id) => MINIGAMES[id].interaction === "read").length >= 2;
    const hasTwoExpansions = selected.filter((id) => MINIGAMES[id].expansion).length >= 2;
    if (!hasTwoReads && lastInteraction !== "read") { pushBest(readGames, true); continue; }
    const options = hasTwoExpansions ? shuffled : expansionGames;
    const diverse = options.filter((id) => MINIGAMES[id].interaction !== lastInteraction);
    pushBest(diverse.length ? diverse : shuffled, true);
  }
  while (selected.length < SESSION_GAME_COUNT - 1) pushBest(shuffled, true);
  pushBest(shuffled.filter((id) => MINIGAMES[id].finaleSuitable), true);
  if (selected.length < SESSION_GAME_COUNT) for (const id of shuffled) if (!selected.includes(id) && selected.length < SESSION_GAME_COUNT) selected.push(id);
  return selected;
}

function createRound(number: number, minigameId: string, config: PartyRound["config"], now: number, rules: HouseRule[], players: Player[]): PartyRound {
  const firstCommit = rules.find((rule) => rule.effect.type === "forced-first");
  const preferredId = firstCommit?.effect.type === "forced-first" ? firstCommit.effect.playerId : null;
  const firstCommitPlayerId = preferredId && players.some((player) => player.id === preferredId) ? preferredId : null;
  return { number, minigameId, startedAt: now, deadlineAt: now + ROUND_SECONDS * 1000, config: structuredClone(config), submissions: {}, firstCommitPlayerId, result: null };
}
function createSession(room: Room, seed = randomBytes(16).toString("hex"), avoidSlots?: string[]): PartySession {
  let attempt = 0;
  let selectedSeed = seed;
  let gameSlots = selectSessionGames(selectedSeed);
  while (avoidSlots && gameSlots.join("|") === avoidSlots.join("|") && attempt < 8) {
    selectedSeed = `${seed}:runback:${++attempt}`;
    gameSlots = selectSessionGames(selectedSeed);
  }
  const firstGame = MINIGAMES[gameSlots[0]];
  return {
    phase: "game-intro", gameNumber: 1, gameSlots, seed: selectedSeed,
    objectives: assignObjectives(selectedSeed, room.players, gameSlots),
    chaos: Object.fromEntries(room.players.map((player) => [player.id, 2])), activePowers: [], scoreProgression: [Object.fromEntries(room.players.map((player) => [player.id, 0]))],
    gameConfig: firstGame.config({ players: room.players, gameNumber: 1 }),
    scores: Object.fromEntries(room.players.map((player) => [player.id, 0])), round: null,
    activeRules: [], offeredRules: [], newlyActivatedRule: null, ruleWinnerId: null, history: [], awards: [],
  };
}

function hydrateSession(room: Room) {
  const session = room.session;
  if (!session) return;
  if (!session.seed) session.seed = `${room.id}:legacy-session`;
  if (!session.objectives) session.objectives = assignObjectives(session.seed, room.players, session.gameSlots);
  if (!session.chaos) session.chaos = Object.fromEntries(room.players.map((player) => [player.id, 2]));
  if (!session.activePowers) session.activePowers = [];
  if (!session.scoreProgression) session.scoreProgression = [Object.fromEntries(room.players.map((player) => [player.id, 0]))];
}
function selectWinner(players: Player[], round: PartyRound) {
  return [...players].sort((a, b) => (round.result?.points[b.id] ?? 0) - (round.result?.points[a.id] ?? 0) || players.indexOf(a) - players.indexOf(b))[0]?.id ?? null;
}
function rulePool(session: PartySession, players: Player[]): HouseRule[] {
  return HOUSE_RULES.filter((rule) => rule.id === "double-down"
    ? session.activeRules.filter((active) => active.id === rule.id).length < 2
    : rule.canStack || !session.activeRules.some((active) => active.id === rule.id)).map((rule) => {
    if (rule.id === "underdog") return { ...rule, effect: { type: "last-place-bonus", points: 1 } };
    if (rule.id === "double-down") return { ...rule, effect: { type: "score-multiplier", multiplier: 2 } };
    if (rule.id === "first-commit") return { ...rule, effect: { type: "forced-first", playerId: players[0]?.id ?? "" } };
    if (rule.id === "safety-net") return { ...rule, effect: { type: "score-floor", playerId: players[0]?.id ?? "" } };
    return { ...rule, effect: { type: "bounty", points: 2, targetId: players[0]?.id ?? "" } };
  });
}
function chooseOffers(session: PartySession, players: Player[]) {
  const pool = seededShuffle(rulePool(session, players).map((rule) => {
    const target = seededShuffle(players, `${session.seed}:rule-target:${session.gameNumber}:${rule.id}`)[0]?.id ?? "";
    if (rule.effect.type === "forced-first" || rule.effect.type === "score-floor") return { ...rule, effect: { ...rule.effect, playerId: target } };
    if (rule.effect.type === "bounty") return { ...rule, effect: { ...rule.effect, targetId: target } };
    return rule;
  }), `${session.seed}:offers:${session.gameNumber}`);
  session.offeredRules = pool;
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
  const beforePowers = { ...points };
  for (const power of [...powers].filter((item) => item.gameNumber === gameNumber).sort((a, b) => a.actorId.localeCompare(b.actorId) || a.id.localeCompare(b.id))) {
    const actor = points[power.actorId];
    if (actor === undefined) continue;
    if (power.id === "guard" && actor < 0) {
      modifiers[power.actorId].push(`Soft Landing power +${Math.abs(actor)}`);
      points[power.actorId] = 0;
    } else if (power.id === "amplify" && actor > 0) {
      points[power.actorId]++;
      modifiers[power.actorId].push("Turn It Up +1");
    } else if (power.id === "bounty" && power.targetId && beforePowers[power.targetId] !== undefined && beforePowers[power.actorId] > beforePowers[power.targetId]) {
      points[power.actorId] += 2;
      modifiers[power.actorId].push(`Side Bet +2 over ${players.find((player) => player.id === power.targetId)?.name ?? "marked player"}`);
    }
    game.events.push({ type: "power", playerId: power.actorId, powerId: power.id });
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
  const resolution = definition.resolve({ players: room.players, submissions: round.submissions, scores: session.scores, config: round.config });
  const counts = Object.fromEntries(round.config.options.map(({ id }) => [id, Object.values(round.submissions).filter((choice) => choice === id).length]));
  round.result = applyHouseRules(room.players, session.scores, session.activeRules, resolution, counts, round.number, session.activePowers);
  const highScore = Math.max(...room.players.map((player) => round.result!.points[player.id] ?? 0));
  for (const player of room.players) round.result.events.push({ type: "round-score", playerId: player.id, points: round.result.points[player.id] ?? 0, highest: (round.result.points[player.id] ?? 0) === highScore });
  advanceObjectives(session.objectives, round.result.events, round.minigameId);
  for (const [playerId, earned] of Object.entries(round.result.points)) session.scores[playerId] = Math.max(0, (session.scores[playerId] ?? 0) + earned);
  for (const player of room.players) {
    if (!Object.hasOwn(round.submissions, player.id)) continue;
    const earnings = Math.min(3, 1 + Math.floor(Math.max(0, round.result.points[player.id] ?? 0) / 3));
    session.chaos[player.id] = Math.min(8, (session.chaos[player.id] ?? 0) + earnings);
  }
  session.scoreProgression.push(structuredClone(session.scores));
  session.activePowers = [];
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
      room.session = createSession(room);
      break;
    }
    case "continue-session": {
      if (uid !== room.hostId) throw new Error("Only the host can continue the party");
      if (!session || session.phase !== "intermission") throw new Error("The party is not at an intermission");
      if (session.gameNumber >= session.gameSlots.length) {
        for (const player of room.players) {
          const objective = session.objectives[player.id];
          if (objective?.completed) session.scores[player.id] = (session.scores[player.id] ?? 0) + objective.reward;
        }
        session.scoreProgression[session.scoreProgression.length - 1] = structuredClone(session.scores);
        session.awards = resolveAwards(session.history, room.players);
        session.phase = "final-results";
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
      room.session = createSession(room, randomBytes(16).toString("hex"), session.gameSlots);
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
      if (Object.hasOwn(session.round.submissions, uid)) throw new Error("Your choice is already locked in");
      if (typeof action.value !== "string") throw new Error("Choose a power shown");
      const [id, targetId] = action.value.split(":");
      if (!Object.hasOwn(POWERS, id)) throw new Error("Choose a power shown");
      if (POWERS[id as keyof typeof POWERS].targetRequired && (!targetId || targetId === uid || !room.players.some((candidate) => candidate.id === targetId))) throw new Error("Choose another player for the side bet");
      if (!POWERS[id as keyof typeof POWERS].targetRequired && targetId) throw new Error("Choose a power shown");
      if (session.activePowers.some((power) => power.actorId === uid && power.gameNumber === session.gameNumber)) throw new Error("You already used a power this game");
      const cost = POWERS[id as keyof typeof POWERS].cost;
      if ((session.chaos[uid] ?? 0) < cost) throw new Error("Not enough Chaos. Earn more by playing rounds.");
      session.chaos[uid] -= cost;
      session.activePowers.push({ id: id as keyof typeof POWERS, actorId: uid, ...(targetId ? { targetId } : {}), gameNumber: session.gameNumber });
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
  hydrateSession(room);
  resolveRound(room, now);
  const session = room.session;
  return {
    id: room.id, code: room.code, hostId: room.hostId, revision: room.revision, players: room.players.map((player) => ({ ...player })), me: uid, serverNow: now,
    session: session ? (() => {
      const publicSession = structuredClone(session);
      const myObjective = structuredClone(publicSession.objectives[uid]);
      const myChaos = publicSession.chaos[uid] ?? 0;
      const myPowers = publicSession.activePowers.filter((power) => power.actorId === uid);
      const objectiveReveal = session.phase === "final-results" ? structuredClone(publicSession.objectives) : undefined;
      delete (publicSession as unknown as Record<string, unknown>).seed;
      delete (publicSession as unknown as Record<string, unknown>).objectives;
      delete (publicSession as unknown as Record<string, unknown>).chaos;
      delete (publicSession as unknown as Record<string, unknown>).activePowers;
      return { ...publicSession, myObjective, myChaos, myPowers, ...(objectiveReveal ? { objectiveReveal } : {}), round: session.round ? {
      number: session.round.number, minigameId: session.round.minigameId, startedAt: session.round.startedAt, deadlineAt: session.round.deadlineAt, config: structuredClone(session.round.config),
      firstCommitPlayerId: session.round.firstCommitPlayerId, result: session.round.result ? structuredClone(session.round.result) : null, answeredCount: Object.keys(session.round.submissions).length,
      myChoice: session.round.submissions[uid] ?? null, submittedIds: session.phase === "active-game" ? Object.keys(session.round.submissions) : [],
      } : null };
    })() : null,
  };
}
