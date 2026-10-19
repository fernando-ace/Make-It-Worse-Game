import { describe, expect, it } from "vitest";
import { assertBetaOperatorAllowed, PRODUCTION_SUPABASE_PROJECT_REF } from "../lib/environment-safety.mjs";
import { sanitizeEvidence } from "../scripts/beta.mjs";

describe("beta operator safety", () => {
  it("rejects production for all beta operator operations", () => {
    expect(() => assertBetaOperatorAllowed({
      VERCEL_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
      BETA_SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
    }, "beta cleanup")).toThrow(/verified non-production/);
  });

  it("exports only approved non-private fields in stable order", () => {
    const evidence = sanitizeEvidence({
      events: [
        { event_name: "session_started", occurred_at: "2026-10-18T12:00:00Z", session_key: "a".repeat(64), game_id: "cross-my-heart" },
        { event_name: "room_created", occurred_at: "2026-10-18T11:00:00Z", session_key: "b".repeat(64), player_count: 3 },
      ],
      metrics: [{ sessionKey: "a".repeat(64), gameNumber: 1, gameId: "cross-my-heart", gameDurationMs: 1234, objectivesCompleted: 1 }],
    });
    expect(evidence.events[0].event_name).toBe("room_created");
    expect(evidence.metrics[0].gameDurationMs).toBe(1234);
    expect(JSON.stringify(evidence)).not.toMatch(/room_id|comment|answer|objective_text|private_hint|token/i);
  });

  it("rejects unexpected private fields instead of exporting them", () => {
    expect(() => sanitizeEvidence({
      events: [{ event_name: "session_started", private_hint: "hidden" }],
      metrics: [],
    })).toThrow(/unapproved field private_hint/);
  });
});
