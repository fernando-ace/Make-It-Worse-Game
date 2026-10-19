#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { assertBetaOperatorAllowed, getEnvironmentSafety } from "../lib/environment-safety.mjs";

const { loadEnvConfig } = nextEnv;

const eventFields = [
  "event_name", "occurred_at", "session_key", "game_id", "game_number",
  "player_count", "chaos_intensity", "house_rule_id", "power_id", "error_code",
];
const metricFields = [
  "occurred_at", "version", "sessionKey", "playerCount", "gameNumber", "gameId",
  "completed", "beatTransition", "decisionMs", "gameDurationMs",
  "firstBeatDurationMs", "secondBeatDurationMs", "missingActions", "powerUsed",
  "powerId", "chaosSpent", "chaosEarned", "powerSuccesses", "powerMisses",
  "activeRules", "ruleSelected", "selectedRuleId", "replayStarted",
  "ruleScoringApplications", "promisesKept", "promisesBroken",
  "objectivesCompleted", "scoreSpread", "negativeContributions", "leadChanged",
  "promiseEvents", "gambleEvents", "targetEvents", "allianceEvents",
  "betrayalEvents", "contributionEvents", "readEvents", "protectionEvents",
  "sessionDurationMs", "sessionCompleted",
];

export function sanitizeEvidence(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.events) || !Array.isArray(input.metrics)) {
    throw new Error("Beta evidence export has an unsupported shape.");
  }
  const rows = (values, fields, label) => values.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Invalid ${label} row ${index}.`);
    const keys = Object.keys(row);
    const unknown = keys.find((key) => !fields.includes(key));
    if (unknown) throw new Error(`Refusing beta export with unapproved field ${unknown}.`);
    const safe = {};
    for (const field of fields) if (Object.hasOwn(row, field) && row[field] !== null) safe[field] = row[field];
    return safe;
  });
  const events = rows(input.events, eventFields, "event").sort((a, b) =>
    String(a.occurred_at ?? "").localeCompare(String(b.occurred_at ?? "")) ||
    String(a.event_name ?? "").localeCompare(String(b.event_name ?? "")) ||
    String(a.session_key ?? "").localeCompare(String(b.session_key ?? "")) ||
    Number(a.game_number ?? 0) - Number(b.game_number ?? 0) ||
    String(a.game_id ?? "").localeCompare(String(b.game_id ?? ""))
  );
  const metrics = rows(input.metrics, metricFields, "metric").sort((a, b) =>
    String(a.occurred_at ?? "").localeCompare(String(b.occurred_at ?? "")) ||
    String(a.sessionKey ?? "").localeCompare(String(b.sessionKey ?? "")) ||
    Number(a.gameNumber ?? 0) - Number(b.gameNumber ?? 0) ||
    String(a.gameId ?? "").localeCompare(String(b.gameId ?? ""))
  );
  return { events, metrics };
}

function usage() {
  return [
    "Usage:",
    "  npm run beta -- doctor",
    "  npm run beta -- export [--since ISO_DATE] [--out work/beta-evidence.json]",
    "  npm run beta -- cleanup --room-id UUID --room-code CODE --confirm",
    "",
    "Export and cleanup require a verified non-production Make It Worse beta project.",
    "Cleanup removes one explicitly named room and its linked beta evidence.",
  ].join("\n");
}

function printDoctor() {
  const safety = getEnvironmentSafety();
  console.log(JSON.stringify({
    deploymentClass: safety.deploymentClass,
    projectRef: safety.projectRef ?? "unknown",
    backendClass: safety.backendClass,
    productionBackend: safety.isProductionBackend,
    betaBackend: safety.isBetaBackend,
    multiplayerWrites: safety.runtimeMutationAllowed,
    browserTestPermission: safety.browserTestAllowed,
    betaExportPermission: safety.betaExportAllowed,
    betaCleanupPermission: safety.betaCleanupAllowed,
  }, null, 2));
  if (!safety.runtimeMutationAllowed) process.exitCode = 1;
}

function argValue(args, key) {
  const index = args.indexOf(key);
  return index < 0 ? undefined : args[index + 1];
}

function betaClient(operation) {
  assertBetaOperatorAllowed(process.env, operation);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error(`Refusing ${operation}: Supabase server configuration is incomplete.`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function exportEvidence(args) {
  const safety = assertBetaOperatorAllowed(process.env, "beta export");
  const since = argValue(args, "--since");
  if (since && !Number.isFinite(Date.parse(since))) throw new Error("--since must be a valid ISO date.");
  const outArg = argValue(args, "--out") ?? "work/beta-evidence.json";
  const outPath = resolve(outArg);
  const workPath = resolve("work");
  const outRelative = relative(workPath, outPath);
  if (!outRelative || outRelative.startsWith(`..${sep}`) || outRelative === ".." || isAbsolute(outRelative)) {
    throw new Error("Beta exports must be written under work/.");
  }
  const db = betaClient("beta export");
  const { data, error } = await db.rpc("cr_export_beta_evidence", { p_since: since ?? null });
  if (error || !data) throw new Error("Beta export failed. Verify the beta schema and operator permissions.");
  const evidence = sanitizeEvidence(data);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "w", mode: 0o600 });
  console.log(JSON.stringify({ operation: "export", projectRef: safety.projectRef, events: evidence.events.length, metricRows: evidence.metrics.length, output: outPath }, null, 2));
}

async function cleanup(args) {
  if (!args.includes("--confirm")) throw new Error("Cleanup requires explicit --confirm intent.");
  const roomId = argValue(args, "--room-id");
  const roomCode = argValue(args, "--room-code")?.toUpperCase();
  if (!roomId || !/^[0-9a-f-]{36}$/i.test(roomId) || !roomCode || !/^[A-Z2-9]{6}$/.test(roomCode)) {
    throw new Error("Cleanup requires a room UUID and matching six-character room code.");
  }
  const safety = assertBetaOperatorAllowed(process.env, "beta cleanup");
  const db = betaClient("beta cleanup");
  const { data, error } = await db.rpc("cr_beta_cleanup_room", { p_room_id: roomId, p_room_code: roomCode });
  if (error || !data) throw new Error("Beta cleanup failed. Verify the room id/code and beta schema.");
  console.log(JSON.stringify({ operation: "cleanup", projectRef: safety.projectRef, ...data }, null, 2));
}

async function main() {
  loadEnvConfig(process.cwd());
  const [command = "doctor", ...args] = process.argv.slice(2);
  if (["--help", "-h", "help"].includes(command)) return console.log(usage());
  if (command === "doctor") return printDoctor();
  if (command === "export") return exportEvidence(args);
  if (command === "cleanup") return cleanup(args);
  throw new Error(`Unknown beta operation: ${command}\n${usage()}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Beta operation failed.");
    process.exitCode = 1;
  });
}
