import { describe, expect, it } from "vitest";
import { advanceObjectives, assignObjectives, OBJECTIVES } from "../lib/objectives";
import type { Player } from "../lib/types";

const players: Player[] = ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase(), seenAt: 0 }));

describe("secret objective registry", () => {
  it("assigns repeatable objectives only from the selected lineup", () => {
    const slots = ["split-decision", "bluff-check", "escalation-ladder", "favor-bank", "group-tab", "hot-potato"];
    const first = assignObjectives("seed-123", players, slots);
    expect(assignObjectives("seed-123", players, slots)).toEqual(first);
    expect(new Set(Object.values(first).map((objective) => objective.id)).size).toBe(players.length);
    for (const objective of Object.values(first)) {
      const definition = OBJECTIVES.find((item) => item.id === objective.id)!;
      expect(definition.compatibleGames.some((id) => slots.includes(id))).toBe(true);
      expect(objective.progress).toBe(0);
      expect(objective.completed).toBe(false);
      expect(objective.reward).toBeGreaterThanOrEqual(3);
      expect(objective.reward).toBeLessThanOrEqual(4);
    }
  });

  it("tracks qualifying events and stops progress at completion", () => {
    const definition = OBJECTIVES.find((item) => item.id === "sharp-read")!;
    const state = { id: definition.id, title: definition.title, description: definition.description, progress: 0, target: definition.target, completed: false, reward: definition.reward };
    const event = { type: "read", playerId: "a", accurate: true } as const;
    const gameId = definition.compatibleGames[0];
    advanceObjectives({ a: state }, [event], gameId);
    const afterOne = state.progress;
    expect(afterOne).toBe(1);
    advanceObjectives({ a: state }, Array.from({ length: state.target }, () => event), gameId);
    expect(state.progress).toBe(1);
    advanceObjectives({ a: state }, [event], definition.compatibleGames[1]);
    expect(state.completed).toBe(true);
    expect(state.progress).toBe(state.target);
    advanceObjectives({ a: state }, [event], gameId);
    expect(state.progress).toBe(state.target);
  });
});
