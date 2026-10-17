import type { Action, Room } from "./types";
import { POWERS } from "./powers";
import { betaSessionKey } from "./beta";

/** Numeric, server-derived operational evidence. Never serialize rooms or events into logs. */
export function partyMetrics(before: Room, after: Room, action?: Action) {
  const session = after.session;
  if (!session) return null;
  const prior = before.session, round = session.round;
  const history = session.history ?? [];
  const completed = history.length > (prior?.history?.length ?? 0);
  const power = session.activePowers.find(item => !prior?.activePowers?.some(old => old.actorId === item.actorId && old.gameNumber === item.gameNumber));
  const result = completed ? history.at(-1)?.result : undefined;
  const changedBeat = round?.beat?.index !== prior?.round?.beat?.index && round?.beat?.index === 1;
  const activeRules = session.activeRules ?? [];
  const rule = action?.type === "select-rule" && activeRules.length > (prior?.activeRules?.length ?? 0);
  const final = session.phase === "final-results" && prior?.phase !== "final-results";
  const replayStarted = action?.type === "restart-session";
  if (!completed && !power && !changedBeat && !rule && !final && !replayStarted) return null;
  const events = result?.events ?? [];
  const scores = Object.values(session.scores ?? {});
  return {
    version: 2,
    sessionKey: betaSessionKey(after.id, session.seed),
    playerCount: after.players.length,
    gameNumber: session.gameNumber,
    gameId: session.gameSlots[session.gameNumber - 1],
    completed: Number(completed),
    beatTransition: Number(changedBeat),
    decisionMs: completed && round ? Math.max(0, (round.completedAt ?? round.startedAt) - (round.openedAt ?? round.startedAt)) : 0,
    powerUsed: Number(Boolean(power)),
    powerId: power?.id,
    chaosSpent: power ? POWERS[power.id].cost : 0,
    chaosEarned: events.reduce((n, e) => n + (e.type === "chaos-earned" ? e.amount : 0), 0),
    powerSuccesses: events.filter(e => e.type === "power" && e.outcome === "success").length,
    powerMisses: events.filter(e => e.type === "power" && e.outcome === "miss").length,
    activeRules: activeRules.length,
    ruleSelected: Number(Boolean(rule)),
    selectedRuleId: rule && typeof action?.value === "string" ? action.value : undefined,
    replayStarted: Number(replayStarted),
    ruleScoringApplications: result ? Object.values(result.modifiers).flat().filter(line => activeRules.some(r => line.startsWith(r.name))).length : 0,
    promisesKept: events.filter(e => e.type === "promise" && e.kept).length,
    promisesBroken: events.filter(e => e.type === "promise" && !e.kept).length,
    objectivesCompleted: Object.values(session.objectives ?? {}).filter(o => o.completed).length,
    scoreSpread: scores.length ? Math.max(...scores) - Math.min(...scores) : 0,
    sessionDurationMs: final && session.completedAt && session.startedAt ? Math.max(0, session.completedAt - session.startedAt) : 0,
    sessionCompleted: Number(final),
  };
}
export function recordPartyMetrics(before: Room, after: Room, action?: Action) {
  const metrics = partyMetrics(before, after, action);
  if (metrics) console.info("PARTY_METRICS", JSON.stringify(metrics));
}
