import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { analyze } from "../scripts/beta-analyze.mjs";

describe("beta evidence analyzer", () => {
  it("summarizes aggregate events and server metrics with sample guardrails", () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/beta-evidence.json", import.meta.url), "utf8"));
    const result = analyze(fixture);
    expect(result.sample).toEqual({ sessions: 1, events: 4, metricRows: 1 });
    expect(result.completion.completed).toBe(1);
    expect(result.metrics.beatTransitions).toBe(1);
    expect(result.gameAppearance).toEqual({ "cross-my-heart": 1 });
    expect(result.evidenceNote).toContain("Observation");
  });
  it("rejects raw or unrecognized fields before producing an export", () => {
    expect(() => analyze([{ name: "game_completed", player_name: "Ada" }])).toThrow(/sensitive field/);
    expect(() => analyze([{ name: "game_completed", comment: "private note" }])).toThrow(/sensitive field/);
  });

  it("aggregates reconnect, abandonment, multi-beat timing, replay, legacy games, rules, powers, and Chaos deterministically", () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/beta-evidence-field-matrix.json", import.meta.url), "utf8"));
    const first = analyze(fixture);
    expect(analyze(fixture)).toEqual(first);
    expect(first.sample.sessions).toBe(4);
    expect(first.completion).toEqual({ started: 3, completed: 1, replay: 1 });
    expect(first.reconnects).toEqual({ attempts: 2, succeeded: 1, failed: 1 });
    expect(first.gameAppearance).toEqual({ "cross-my-heart": 1, "make-it-worse": 1, "signal-noise": 1 });
    expect(first.metrics).toMatchObject({ completedGames: 3, beatTransitions: 2, meanFirstBeatMs: 35000, meanSecondBeatMs: 52500, chaosEarned: 3, chaosSpent: 4, powerSuccesses: 1, powerMisses: 1, replays: 1, ruleScoringApplications: 1 });
    expect(first.evidenceNote).toContain("fewer than 10 sessions");
  });

  it("rejects the malformed export fixture", () => {
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/beta-evidence-malformed.json", import.meta.url), "utf8"));
    expect(() => analyze(fixture)).toThrow(/sensitive field/);
  });
});
