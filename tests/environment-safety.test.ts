import { describe, expect, it } from "vitest";
import { getEnvironmentSafety, PRODUCTION_SUPABASE_PROJECT_REF } from "../lib/environment-safety.mjs";

const betaRef = "makeitworsebeta123456";
const testRef = "makeitworsetest123456";
const url = (ref: string) => `https://${ref}.supabase.co`;

describe("environment safety", () => {
  it("allows production deployment writes only to the production project", () => {
    const safety = getEnvironmentSafety({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: url(PRODUCTION_SUPABASE_PROJECT_REF),
    });
    expect(safety.runtimeMutationAllowed).toBe(true);
    expect(safety.browserTestAllowed).toBe(false);
    expect(safety.betaExportAllowed).toBe(false);
  });

  it("allows preview writes and browser testing only with the configured beta project", () => {
    const safety = getEnvironmentSafety({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: url(betaRef),
      BETA_SUPABASE_PROJECT_REF: betaRef,
    });
    expect(safety.runtimeMutationAllowed).toBe(true);
    expect(safety.browserTestAllowed).toBe(true);
    expect(safety.betaExportAllowed).toBe(true);
  });

  it("allows development against the configured test backend", () => {
    const safety = getEnvironmentSafety({
      NODE_ENV: "development",
      NEXT_PUBLIC_SUPABASE_URL: url(testRef),
      TEST_SUPABASE_PROJECT_REF: testRef,
    });
    expect(safety.runtimeMutationAllowed).toBe(true);
    expect(safety.browserTestAllowed).toBe(true);
    expect(safety.betaExportAllowed).toBe(false);
  });

  it("refuses Preview pointed at the production project", () => {
    const safety = getEnvironmentSafety({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: url(PRODUCTION_SUPABASE_PROJECT_REF),
      BETA_SUPABASE_PROJECT_REF: betaRef,
    });
    expect(safety.runtimeMutationAllowed).toBe(false);
    expect(safety.browserTestAllowed).toBe(false);
    expect(safety.betaCleanupAllowed).toBe(false);
  });

  it("refuses beta operator tools on the production project", () => {
    const safety = getEnvironmentSafety({
      BETA_DEPLOYMENT_CLASS: "development",
      NEXT_PUBLIC_SUPABASE_URL: url(PRODUCTION_SUPABASE_PROJECT_REF),
      BETA_SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
    });
    expect(safety.runtimeMutationAllowed).toBe(false);
    expect(safety.betaExportAllowed).toBe(false);
    expect(safety.betaCleanupAllowed).toBe(false);
  });

  it("fails safely for missing, malformed, or contradictory configuration", () => {
    for (const env of [
      {},
      { VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "not a url" },
      { VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: "not a url", SUPABASE_PROJECT_REF: betaRef, BETA_SUPABASE_PROJECT_REF: betaRef },
      { VERCEL_ENV: "preview", NEXT_PUBLIC_SUPABASE_URL: url(betaRef), SUPABASE_PROJECT_REF: testRef, BETA_SUPABASE_PROJECT_REF: betaRef },
      { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: url(PRODUCTION_SUPABASE_PROJECT_REF) },
    ]) {
      const safety = getEnvironmentSafety(env);
      expect(safety.runtimeMutationAllowed).toBe(false);
      expect(safety.browserTestAllowed).toBe(false);
      expect(safety.betaExportAllowed).toBe(false);
    }
  });
});
