export const PRODUCTION_SUPABASE_PROJECT_REF = "jfosecuafntktpudjhyj";

const classes = new Set(["production", "preview", "development", "test"]);

export function supabaseProjectRefFromUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) return "local";
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function isPrivateNetworkHost(host) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

function deploymentClass(env) {
  const vercel = String(env.VERCEL_ENV ?? "").toLowerCase();
  if (classes.has(vercel)) return vercel;

  // Vercel injects VERCEL_ENV server-side. This public marker is used by the
  // browser, where server-only environment variables are intentionally absent.
  const publicClass = String(env.NEXT_PUBLIC_DEPLOYMENT_CLASS ?? "").toLowerCase();
  if (classes.has(publicClass)) return publicClass;

  // Local operator overrides can identify only non-production contexts.
  const localClass = String(env.BETA_DEPLOYMENT_CLASS ?? "").toLowerCase();
  if (["development", "test"].includes(localClass)) return localClass;
  if (env.NODE_ENV === "test" || env.CI === "true") return "test";
  if (env.NODE_ENV === "development") return "development";
  return "unknown";
}

export function getEnvironmentSafety(env = process.env) {
  const deployment = deploymentClass(env);
  const localPartyMode = [env.LOCAL_PARTY_MODE, env.NEXT_PUBLIC_LOCAL_PARTY_MODE]
    .some((value) => String(value ?? "").toLowerCase() === "true");
  const parsedUrlRef = supabaseProjectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const urlRef = parsedUrlRef ?? (localPartyMode && isPrivateNetworkUrl(env.NEXT_PUBLIC_SUPABASE_URL) ? "local" : null);
  const explicitRef = String(env.SUPABASE_PROJECT_REF ?? "").trim().toLowerCase();
  const hasUrl = Boolean(String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim());
  const refMismatch = Boolean((hasUrl && !urlRef) || (explicitRef && urlRef && explicitRef !== urlRef));
  const projectRef = urlRef ?? (explicitRef || null);
  const betaRef = String(env.BETA_SUPABASE_PROJECT_REF ?? env.NEXT_PUBLIC_BETA_SUPABASE_PROJECT_REF ?? "").trim().toLowerCase();
  const testRef = String(env.TEST_SUPABASE_PROJECT_REF ?? env.NEXT_PUBLIC_TEST_SUPABASE_PROJECT_REF ?? "").trim().toLowerCase();

  let backend = "unknown";
  if (!refMismatch && projectRef === PRODUCTION_SUPABASE_PROJECT_REF) backend = "production";
  else if (!refMismatch && projectRef && betaRef && projectRef === betaRef && betaRef !== testRef) backend = "beta";
  else if (!refMismatch && projectRef && testRef && projectRef === testRef && testRef !== betaRef) backend = "test";
  else if (!refMismatch && projectRef === "local") backend = "local";

  const runtimeMutationAllowed =
    (deployment === "production" && backend === "production") ||
    (deployment === "preview" && backend === "beta") ||
    (["development", "test"].includes(deployment) && ["test", "local"].includes(backend));
  const betaOperatorAllowed =
    ["preview", "development", "test"].includes(deployment) && backend === "beta";
  const localPartyAllowed = localPartyMode && ["development", "test"].includes(deployment) &&
    backend === "local" && ![env.VERCEL_ENV, env.NEXT_PUBLIC_DEPLOYMENT_CLASS, env.BETA_DEPLOYMENT_CLASS]
      .some((value) => String(value ?? "").toLowerCase() === "production") && String(env.NODE_ENV ?? "").toLowerCase() !== "production";
  const browserTestAllowed =
    ["preview", "development", "test"].includes(deployment) &&
    ["beta", "test", "local"].includes(backend);

  return Object.freeze({
    deploymentClass: deployment,
    projectRef,
    backendClass: backend,
    isProductionBackend: backend === "production",
    isBetaBackend: backend === "beta",
    runtimeMutationAllowed,
    browserTestAllowed: browserTestAllowed || localPartyAllowed,
    betaOperatorAllowed: betaOperatorAllowed || localPartyAllowed,
    betaExportAllowed: betaOperatorAllowed || localPartyAllowed,
    betaCleanupAllowed: betaOperatorAllowed,
    configurationMismatch: refMismatch,
  });
}

function isPrivateNetworkUrl(value) {
  try { return isPrivateNetworkHost(new URL(value).hostname.toLowerCase()); }
  catch { return false; }
}

export function assertRuntimeMutationAllowed(env = process.env) {
  const safety = getEnvironmentSafety(env);
  if (!safety.runtimeMutationAllowed) {
    throw new Error("Supabase environment is not approved for multiplayer writes.");
  }
  return safety;
}

export function assertBetaOperatorAllowed(env = process.env, operation = "beta operation") {
  const safety = getEnvironmentSafety(env);
  if (!safety.betaOperatorAllowed) {
    throw new Error(`Refusing ${operation}: a verified non-production Make It Worse beta backend is required.`);
  }
  return safety;
}

export function browserEnvironment() {
  if (typeof window === "undefined") return process.env;
  return {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_DEPLOYMENT_CLASS: process.env.NEXT_PUBLIC_DEPLOYMENT_CLASS,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_BETA_SUPABASE_PROJECT_REF: process.env.NEXT_PUBLIC_BETA_SUPABASE_PROJECT_REF,
    NEXT_PUBLIC_TEST_SUPABASE_PROJECT_REF: process.env.NEXT_PUBLIC_TEST_SUPABASE_PROJECT_REF,
    NEXT_PUBLIC_LOCAL_PARTY_MODE: process.env.NEXT_PUBLIC_LOCAL_PARTY_MODE,
  };
}
