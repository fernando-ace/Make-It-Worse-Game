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
});
