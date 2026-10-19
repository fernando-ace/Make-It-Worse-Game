#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

const allowed = new Set([
  "sessionKey", "session_key", "name", "event_name", "eventName", "game_id", "gameId", "game_number", "gameNumber", "player_count", "playerCount", "chaos_intensity", "chaosIntensity", "house_rule_id", "houseRuleId", "power_id", "powerId", "error_code", "errorCode", "occurred_at", "created_at", "timestamp", "version", "completed", "beatTransition", "decisionMs", "gameDurationMs", "firstBeatDurationMs", "secondBeatDurationMs", "sessionDurationMs", "sessionCompleted", "powerUsed", "chaosSpent", "chaosEarned", "powerSuccesses", "powerMisses", "activeRules", "ruleSelected", "selectedRuleId", "replayStarted", "ruleScoringApplications", "promisesKept", "promisesBroken", "objectivesCompleted", "scoreSpread", "reconnects", "abandonedPhase", "finaleChaosPoints", "chaosHeld", "scoreContribution", "leadChanges", "leadChanged", "missingActions", "negativeContributions", "promiseEvents", "gambleEvents", "targetEvents", "allianceEvents", "betrayalEvents", "contributionEvents", "readEvents", "protectionEvents", "interactionEvents",
]);
const forbidden = /(^|_)(player_?name|player_?id|raw_?submission|choice|answer|objective_?text|private_?hint|report|auth_?token|ip_?address|payload|comment|conversation)(_|$)/i;
const eventNames = new Set(["landing_viewed", "room_created", "room_joined", "lobby_reached", "session_started", "chaos_intensity_selected", "game_started", "game_completed", "session_round_reached", "house_rule_selected", "power_used", "objective_completed", "objective_revealed", "reconnect_attempted", "reconnect_succeeded", "reconnect_failed", "player_left", "finale_reached", "session_completed", "replay_started", "feedback_opened", "feedback_submitted", "runtime_error"]);
const games = new Set(["split-decision", "make-it-worse", "trust-me", "pile-on", "secret-handshake", "hot-potato", "group-tab", "escalation-ladder", "bluff-check", "favor-bank", "auction-house", "lifeline", "group-project", "prisoners-dilemma", "split-the-difference", "golden-ticket", "cross-my-heart", "signal-noise", "last-seats", "breaking-point"]);
const rules = new Set(["binding-promises", "breathing-room", "underdog", "bounty", "double-down", "first-commit", "safety-net", "target-bonus", "alliance-bonus", "chaos-bonus", "failed-risk-cost", "protection-bonus", "cooperation-bonus"]);
const powers = new Set(["guard", "amplify", "bounty", "bodyguard", "hex", "comeback", "pickpocket", "contrarian", "scout"]);
function assertSafe(value, path = "input") {
  if (Array.isArray(value)) return value.forEach((entry, i) => assertSafe(entry, `${path}[${i}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (forbidden.test(key) || !allowed.has(key)) throw new Error(`Unsupported or sensitive field at ${path}.${key}; export only approved structured metrics.`);
    if ((key === "sessionKey" || key === "session_key") && item != null && !/^[0-9a-f]{64}$/.test(String(item))) throw new Error(`Session keys must be opaque SHA-256 values at ${path}.${key}.`);
    if ((key === "name" || key === "event_name" || key === "eventName") && item != null && !eventNames.has(String(item))) throw new Error(`Unknown event name at ${path}.${key}.`);
    if ((key === "gameId" || key === "game_id") && item != null && !games.has(String(item))) throw new Error(`Unknown game id at ${path}.${key}.`);
    if ((key === "houseRuleId" || key === "house_rule_id" || key === "selectedRuleId") && item != null && !rules.has(String(item))) throw new Error(`Unknown House Rule id at ${path}.${key}.`);
    if ((key === "powerId" || key === "power_id") && item != null && !powers.has(String(item))) throw new Error(`Unknown power id at ${path}.${key}.`);
    assertSafe(item, `${path}.${key}`);
  }
}
const number = (rows, key) => rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0);
const mean = (rows, key) => rows.length ? number(rows, key) / rows.length : null;
const histogram = (rows, key) => Object.fromEntries([...new Set(rows.map(r => r[key]).filter(v => v !== undefined && v !== null))].sort().map(v => [String(v), rows.filter(r => r[key] === v).length]));
function analyze(input) {
  if (!Array.isArray(input) && (!input || typeof input !== "object" || Object.keys(input).some(key => !["events", "metrics"].includes(key)))) throw new Error("Input root may contain only events and metrics arrays.");
  const events = Array.isArray(input) ? input : input.events ?? [];
  const metrics = Array.isArray(input) ? [] : input.metrics ?? [];
  assertSafe(events); assertSafe(metrics);
  if (!Array.isArray(events) || !Array.isArray(metrics)) throw new Error("Input must be an event array or an object with events and metrics arrays.");
  const rows = [...events, ...metrics];
  const sessionOf = row => row.sessionKey ?? row.session_key;
  const sessions = new Set(rows.map(sessionOf).filter(Boolean));
  const eventCount = name => events.filter(r => (r.name ?? r.event_name ?? r.eventName) === name).length;
  const summary = {
    sample: { sessions: sessions.size, events: events.length, metricRows: metrics.length },
    completion: { started: eventCount("session_started"), completed: eventCount("session_completed"), replay: eventCount("replay_started") },
    playerCounts: Object.fromEntries([...new Set(rows.map(r => r.player_count ?? r.playerCount).filter(v => v != null))].sort().map(count => [String(count), new Set(rows.filter(r => (r.player_count ?? r.playerCount) === count).map(sessionOf).filter(Boolean)).size])),
    gameAppearance: (() => { const seen = new Set(); const counts = {}; for (const row of rows) { const game = row.game_id ?? row.gameId; if (!game) continue; const session = sessionOf(row); const key = session ? `${session}:${game}` : `${game}:${row.game_number ?? row.gameNumber ?? "unknown"}`; if (seen.has(key)) continue; seen.add(key); counts[game] = (counts[game] ?? 0) + 1; } return counts; })(),
    reconnects: { attempts: eventCount("reconnect_attempted"), succeeded: eventCount("reconnect_succeeded"), failed: eventCount("reconnect_failed") },
    houseRules: { selected: eventCount("house_rule_selected"), byRule: histogram(events.filter(r => (r.name ?? r.event_name) === "house_rule_selected").map(r => ({ rule: r.house_rule_id ?? r.houseRuleId })), "rule") },
    powers: { uses: eventCount("power_used"), byPower: histogram(events.filter(r => (r.name ?? r.event_name) === "power_used").map(r => ({ power: r.power_id ?? r.powerId })), "power") },
    metrics: {
      completedGames: number(metrics, "completed"), beatTransitions: number(metrics, "beatTransition"), meanDecisionMs: mean(metrics.filter(r => r.completed), "decisionMs"),
      meanGameDurationMs: mean(metrics.filter(r => r.completed), "gameDurationMs"), meanFirstBeatMs: mean(metrics.filter(r => r.beatTransition), "firstBeatDurationMs"), meanSecondBeatMs: mean(metrics.filter(r => r.completed && r.secondBeatDurationMs), "secondBeatDurationMs"), meanSessionDurationMs: mean(metrics.filter(r => r.sessionCompleted), "sessionDurationMs"),
      chaosEarned: number(metrics, "chaosEarned"), chaosSpent: number(metrics, "chaosSpent"), powerSuccesses: number(metrics, "powerSuccesses"), powerMisses: number(metrics, "powerMisses"),
      objectivesCompleted: number(metrics, "objectivesCompleted"), meanScoreSpread: mean(metrics.filter(r => r.completed), "scoreSpread"), leadChanges: number(metrics, "leadChanged") || number(metrics, "leadChanges"), missingActions: number(metrics, "missingActions"), negativeContributions: number(metrics, "negativeContributions"),
      interactions: Object.fromEntries(["promiseEvents", "gambleEvents", "targetEvents", "allianceEvents", "betrayalEvents", "contributionEvents", "readEvents", "protectionEvents"].map(key => [key, number(metrics, key)])),
      replays: number(metrics, "replayStarted"), ruleScoringApplications: number(metrics, "ruleScoringApplications"), promisesKept: number(metrics, "promisesKept"), promisesBroken: number(metrics, "promisesBroken"),
    },
    evidenceNote: sessions.size < 10 ? "Observation: fewer than 10 sessions; treat counts as anecdotal." : sessions.size < 30 ? "Early signal: small sample; compare with human observations." : "Repeated signal: review cohort mix and human observations before changing the game.",
  };
  return summary;
}
function markdown(s) {
  const line = (label, value) => `- **${label}:** ${value}`;
  return ["# Beta evidence summary", "", `Evidence level: **${s.evidenceNote}**`, "", "## Sample", line("Sessions", s.sample.sessions), line("Events", s.sample.events), line("Metric rows", s.sample.metricRows), "", "## Session signals", line("Started / completed / replayed", `${s.completion.started} / ${s.completion.completed} / ${s.completion.replay}`), line("Player-count rows", JSON.stringify(s.playerCounts)), line("Game appearance rows", JSON.stringify(s.gameAppearance)), line("Reconnect attempts / success / failure", `${s.reconnects.attempts} / ${s.reconnects.succeeded} / ${s.reconnects.failed}`), line("House Rule selections", JSON.stringify(s.houseRules)), line("Power uses", JSON.stringify(s.powers)), "", "## Server-derived metrics", ...Object.entries(s.metrics).map(([k,v]) => line(k, v && typeof v === "object" ? JSON.stringify(v) : v ?? "not available")), "", "Counts describe submitted evidence only. They do not estimate enjoyment or statistical significance.", ""].join("\n");
}
async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: npm run beta:analyze -- <sanitized-export.json> [output-prefix]");
  const input = JSON.parse(await readFile(resolve(path), "utf8"));
  const result = analyze(input), prefix = resolve(process.argv[3] ?? path.replace(/\.json$/i, ""));
  await writeFile(`${prefix}.summary.json`, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(`${prefix}.summary.md`, markdown(result));
  console.log(`Analyzed ${basename(path)}: ${result.sample.sessions} sessions, ${result.sample.events} events, ${result.sample.metricRows} metric rows.`);
  console.log(result.evidenceNote);
  console.log(`Wrote ${prefix}.summary.json and ${prefix}.summary.md`);
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
export { analyze };
