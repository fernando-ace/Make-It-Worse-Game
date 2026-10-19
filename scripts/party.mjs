#!/usr/bin/env node
import { spawn } from "node:child_process";
import { isIPv4 } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { getEnvironmentSafety } from "../lib/environment-safety.mjs";

const ROOT = process.cwd();
const VIRTUAL_ADAPTER = /docker|vEthernet|wsl|virtualbox|vmware|hyper-v|tailscale|zerotier|wireguard|\btun\b|\btap\b|bridge|\bbr-|loopback|^eth[0-9]+$/i;
const WIFI_ADAPTER = /wi-?fi|wlan|wlp|wlx|wireless|airport|en[0-9]+/i;
const isIPv4Interface = (address) => address?.family === "IPv4" || address?.family === 4;

export function isLanAddress(value) {
  if (!isIPv4(value)) return false;
  const [a, b] = value.split(".").map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function detectLanAddress(networks = os.networkInterfaces()) {
  const candidates = [];
  for (const [name, addresses] of Object.entries(networks)) {
    for (const address of addresses ?? []) {
      if (isIPv4Interface(address) && !address.internal && isLanAddress(address.address)) {
        candidates.push({ name, address: address.address, virtual: VIRTUAL_ADAPTER.test(name), wifi: WIFI_ADAPTER.test(name) });
      }
    }
  }
  candidates.sort((a, b) => Number(a.virtual) - Number(b.virtual) || Number(b.wifi) - Number(a.wifi));
  return { selected: candidates.find((item) => !item.virtual) ?? candidates[0] ?? null, candidates };
}

export function supabaseLanUrl(apiUrl, host) {
  if (!isLanAddress(host)) throw new Error("--host must be a private IPv4 address on your local network.");
  const url = new URL(apiUrl);
  if (!["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(url.hostname)) {
    throw new Error("Supabase CLI returned an unexpected API host; refusing to advertise it.");
  }
  url.hostname = host;
  return url.toString().replace(/\/$/, "");
}

export function buildPartyRuntimeConfig(host, port, apiUrl) {
  if (!isLanAddress(host)) throw new Error("--host must be a private IPv4 address on your local network.");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be between 1024 and 65535.");
  return {
    gameUrl: `http://${host}:${port}`,
    supabaseUrl: supabaseLanUrl(apiUrl, host),
    nextArgs: ["dev", "--hostname", "0.0.0.0", "--port", String(port)],
  };
}

export function assertLocalPartySafety(env, operation = "local party operation") {
  const safety = getEnvironmentSafety(env);
  if (safety.isProductionBackend || safety.backendClass !== "local" || !safety.betaExportAllowed) {
    throw new Error(`Refusing ${operation}: only a verified local Supabase target is allowed; Production is blocked.`);
  }
  return safety;
}

export function buildLocalPartyManifest(evidence, notes = {}) {
  const sessions = new Map();
  for (const row of evidence.events ?? []) {
    if (!/^[a-f0-9]{64}$/i.test(row.session_key ?? "")) continue;
    sessions.set(row.session_key, { sessionId: row.session_key, playerCount: validPlayerCount(row.player_count) });
  }
  for (const row of evidence.metrics ?? []) {
    if (!/^[a-f0-9]{64}$/i.test(row.sessionKey ?? "")) continue;
    sessions.set(row.sessionKey, { sessionId: row.sessionKey, playerCount: validPlayerCount(row.playerCount) ?? sessions.get(row.sessionKey)?.playerCount ?? null });
  }
  return {
    recordedAt: new Date().toISOString(),
    testLabel: typeof notes.label === "string" ? notes.label.slice(0, 80) : null,
    playerCount: validPlayerCount(notes.players),
    deviceMix: typeof notes.devices === "string" ? notes.devices.slice(0, 120) : null,
    groupType: ["new", "returning", "mixed"].includes(notes.group) ? notes.group : null,
    sessions: [...sessions.values()],
  };
}

function validPlayerCount(value) {
  return Number.isInteger(value) && value >= 2 && value <= 8 ? value : null;
}

function assertHostIsLocalInterface(host) {
  const found = Object.values(os.networkInterfaces()).flat().some((address) =>
    isIPv4Interface(address) && address.address === host && !address.internal);
  if (!found) throw new Error(`--host ${host} is not assigned to this computer. Use an IPv4 address shown by your Wi-Fi/network settings.`);
}

function parseArgs(args) {
  const options = { command: "start", port: 3000 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--host") options.host = args[++i];
    else if (args[i] === "--port") options.port = Number(args[++i]);
    else if (args[i] === "--confirm") options.confirm = true;
    else if (args[i] === "--out") options.out = args[++i];
    else if (args[i] === "--since") options.since = args[++i];
    else if (args[i] === "--label") options.label = args[++i];
    else if (args[i] === "--players") options.players = Number(args[++i]);
    else if (args[i] === "--devices") options.devices = args[++i];
    else if (args[i] === "--group") options.group = args[++i];
    else if (["doctor", "stop", "reset", "export", "help", "--help", "-h"].includes(args[i]) && options.command === "start") options.command = args[i].replace(/^--help$|^-h$/, "help");
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("--port must be between 1024 and 65535.");
  return options;
}

const commandName = process.platform === "win32" ? "npx.cmd" : "npx";
function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env: options.env ?? process.env, stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit", shell: process.platform === "win32" });
    let stdout = "", stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolvePromise({ stdout, stderr }) : reject(new Error(`${command} ${args.join(" ")} failed${stderr ? `: ${stderr.trim()}` : ` (exit ${code})`}`)));
    if (options.onChild) options.onChild(child);
  });
}

async function supabase(args, options = {}) { return run(commandName, ["--yes", "supabase", ...args], options); }

function parseEnv(output) {
  const result = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return result;
}

async function getLocalConfig(host) {
  const { stdout } = await supabase(["status", "-o", "env"], { capture: true });
  const values = parseEnv(stdout);
  const apiUrl = supabaseLanUrl(values.API_URL, host);
  const publishable = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
  const serviceKey = values.SECRET_KEY ?? values.SERVICE_ROLE_KEY;
  if (!publishable || !serviceKey) throw new Error("Local Supabase status did not include expected local keys.");
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
    SUPABASE_SECRET_KEY: serviceKey,
    SUPABASE_PROJECT_REF: "local",
    BETA_DEPLOYMENT_CLASS: "development",
    NEXT_PUBLIC_DEPLOYMENT_CLASS: "development",
    NEXT_PUBLIC_LOCAL_PARTY_MODE: "true",
    LOCAL_PARTY_MODE: "true",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const safety = assertLocalPartySafety(env);
  return { env, apiUrl, safety };
}

function realtimeReachable(apiUrl, publishableKey) {
  if (typeof WebSocket === "undefined") return Promise.resolve(false);
  return new Promise((resolvePromise) => {
    const endpoint = new URL(`${apiUrl}/realtime/v1/websocket`);
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    endpoint.searchParams.set("apikey", publishableKey);
    endpoint.searchParams.set("vsn", "1.0.0");
    const socket = new WebSocket(endpoint);
    const timer = setTimeout(() => { socket.close(); resolvePromise(false); }, 3000);
    socket.addEventListener("open", () => { clearTimeout(timer); socket.close(); resolvePromise(true); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); resolvePromise(false); }, { once: true });
  });
}

function reachablePort(host, port) {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", () => resolvePromise(false));
    server.listen(port, "0.0.0.0", () => server.close(() => resolvePromise(true)));
  });
}

async function doctor(options) {
  const detected = detectLanAddress();
  const host = options.host ?? detected.selected?.address;
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  add("Node", Number(process.versions.node.split(".")[0]) >= 22, process.version);
  const productionClassified = process.env.NODE_ENV === "production" || [process.env.VERCEL_ENV, process.env.NEXT_PUBLIC_DEPLOYMENT_CLASS, process.env.BETA_DEPLOYMENT_CLASS]
    .some((value) => String(value ?? "").toLowerCase() === "production");
  add("Production safety", !productionClassified, productionClassified ? "production classification detected; party operations are refused" : "production backend blocked");
  try { await run("docker", ["info", "--format", "{{.ServerVersion}}"], { capture: true }); add("Docker daemon", true, "running"); }
  catch { add("Docker daemon", false, "not reachable; start Docker Desktop/Engine"); }
  try { await supabase(["--version"], { capture: true }); add("Supabase CLI", true, "available via npx"); }
  catch { add("Supabase CLI", false, "could not run Supabase CLI"); }
  add("LAN address", Boolean(host && isLanAddress(host)), host ?? "no private IPv4 address detected; use --host");
  if (host && !isLanAddress(host)) throw new Error("--host must be a private IPv4 address on your local network.");
  if (options.host && host) assertHostIsLocalInterface(host);
  if (host) {
    try {
      const { apiUrl, env } = await getLocalConfig(host);
      const health = await fetch(`${apiUrl}/auth/v1/health`, { signal: AbortSignal.timeout(3000) });
      add("Supabase API via advertised address", health.ok, `${apiUrl} (${health.status})`);
      const realtime = await realtimeReachable(apiUrl, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
      add("Realtime WebSocket via advertised address", realtime, `${apiUrl}/realtime/v1/websocket`);
    } catch (error) { add("Local Supabase", false, error.message); }
  }
  add("Next.js port", await reachablePort("0.0.0.0", options.port), `TCP ${options.port}`);
  console.log("MAKE IT WORSE LOCAL PARTY LAB — PREFLIGHT");
  console.log("Safety: Production blocked; no remote Supabase target is accepted.");
  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}`);
  if (detected.candidates.length > 1) console.log(`LAN candidates: ${detected.candidates.map(({ name, address }) => `${name}=${address}`).join(", ")}`);
  if (detected.selected?.virtual) console.log("Warning: only a virtual network adapter was detected; choose your Wi-Fi IPv4 with --host.");
  if (host) console.log(`Advertised host: ${host} (override with --host <private IPv4>)`);
  console.log("Firewall rules are not changed. Phones must be on the same Wi-Fi/LAN and allowed by the host firewall.");
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

function selectHost(options) {
  if (options.host) {
    if (!isLanAddress(options.host)) throw new Error("--host must be a private IPv4 address on your local network.");
    assertHostIsLocalInterface(options.host);
    return options.host;
  }
  const result = detectLanAddress();
  if (!result.selected) throw new Error("No private IPv4 address found. Connect to your local network or pass --host <private IPv4>.");
  if (result.selected.virtual) console.log("Warning: selected address belongs to a virtual adapter. Override with --host if this is not your Wi-Fi address.");
  if (result.candidates.length > 1) console.log(`Detected addresses: ${result.candidates.map(({ name, address }) => `${name}=${address}`).join(", ")}`);
  return result.selected.address;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    console.log("npm run party [-- --host 192.168.1.50] [--port 3000]\nnpm run party -- doctor [--host 192.168.1.50]\nnpm run party -- stop [--confirm]\nnpm run party -- reset --confirm\nnpm run party -- export [--since ISO_DATE] [--out work/local-party-evidence.json]");
    return;
  }
  if (options.command === "doctor") return doctor(options);
  const productionClassified = process.env.NODE_ENV === "production" || [process.env.VERCEL_ENV, process.env.NEXT_PUBLIC_DEPLOYMENT_CLASS, process.env.BETA_DEPLOYMENT_CLASS]
    .some((value) => String(value ?? "").toLowerCase() === "production");
  if (["start", "reset", "export"].includes(options.command) && productionClassified) {
    throw new Error("Production deployment classification detected; Local Party Lab operation refused.");
  }
  if (options.command === "stop") {
    if (!options.confirm) throw new Error("Stop Supabase after party night with: npm run party -- stop --confirm. Data and Docker volumes are preserved.");
    await supabase(["stop"]);
    console.log("Local Supabase stopped. Data is preserved. No other Docker workloads were stopped.");
    return;
  }
  if (options.command === "reset") {
    if (!options.confirm) throw new Error("Reset deletes local Supabase data, including local sessions and rooms. Repeat with --confirm.");
    const host = selectHost(options);
    await supabase(["start", "--exclude", "studio,logflare,vector,edge-runtime,storage-api,postgres-meta,functions"]);
    const { env } = await getLocalConfig(host);
    assertLocalPartySafety(env, "local reset");
    await supabase(["db", "reset", "--local"]);
    console.log("Local database reset and repository migrations reapplied. Docker services are unchanged.");
    return;
  }
  if (options.command === "export") {
    const host = selectHost(options);
    const { env } = await getLocalConfig(host);
    const out = options.out ?? "work/local-party-evidence.json";
    const args = ["scripts/beta.mjs", "export", "--out", out];
    if (options.since) args.push("--since", options.since);
    await run(process.execPath, args, { env });
    const evidence = JSON.parse(await readFile(resolve(out), "utf8"));
    const manifest = buildLocalPartyManifest(evidence, options);
    await writeFile(`${resolve(out)}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.log(`Wrote local-only session manifest: ${resolve(out)}.manifest.json`);
    return;
  }

  const host = selectHost(options);
  const { env, apiUrl } = await getLocalConfigAfterStartup(host);
  const runtime = buildPartyRuntimeConfig(host, options.port, apiUrl);
  console.log("MAKE IT WORSE LOCAL PARTY LAB");
  console.log("Backend: LOCAL SUPABASE");
  console.log("Safety: PRODUCTION BLOCKED");
  console.log(`Game: ${runtime.gameUrl}`);
  console.log("Share this address with players on the same network.");
  console.log(`Supabase API: ${runtime.supabaseUrl} (Auth, REST/RPC, and Realtime use this host)`);
  console.log("Keep this terminal open. Press Ctrl+C to stop the app; Supabase data stays local and is preserved.");
  const app = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", ...runtime.nextArgs], { cwd: ROOT, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("spawn", () => resolvePromise(child));
  });
  const shutdown = () => app.kill("SIGINT");
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  const [exitCode, signal] = await new Promise((resolvePromise) => app.once("exit", (...status) => resolvePromise(status)));
  if (exitCode !== 0 && exitCode !== null) process.exitCode = exitCode;
  else if (signal && signal !== "SIGINT") process.exitCode = 1;
}

async function getLocalConfigAfterStartup(host) {
  await supabase(["start", "--exclude", "studio,logflare,vector,edge-runtime,storage-api,postgres-meta,functions"]);
  await supabase(["migration", "up", "--local"]);
  return getLocalConfig(host);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : "Local Party Lab failed."); process.exitCode = 1; });
}
