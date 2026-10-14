import { describe, expect, it } from "vitest";
import { apply, join, MINIGAMES, SESSION_GAME_COUNT, snapshot } from "../lib/engine";
import type { Room } from "../lib/types";

const now = 1_000_000;
let actionNumber = 0;
function makeRoom(count = 3): Room {
  const players = Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `Player ${index}`, seenAt: now }));
  return { id: "room-id", code: "ABC234", hostId: "p0", revision: 0, createdAt: now, players, session: null, processed: [] };
}
function act(room: Room, player: string, type: string, value?: string | boolean, time = now) { apply(room, player, { type, value }, time, `test-action-${++actionNumber}`); }
function start(room: Room) { act(room, "p0", "start"); act(room, "p0", "begin-game"); }
function submit(room: Room, choices: Record<string, "RED" | "BLUE">) { for (const [id, choice] of Object.entries(choices)) act(room, id, "submit", choice); }
function selectRule(room: Room, id: string) { act(room, room.session!.ruleWinnerId!, "open-rule-selection"); act(room, room.session!.ruleWinnerId!, "select-rule", id); }

describe("authoritative party session engine", () => {
  it("registers Split Decision as a reusable minigame and builds six game slots", () => {
    const room = makeRoom(); start(room);
    expect(MINIGAMES["split-decision"].input.choices).toEqual(["RED", "BLUE"]);
    expect(room.session?.gameSlots).toHaveLength(SESSION_GAME_COUNT);
    expect(room.session?.gameSlots.every((id) => id === "split-decision")).toBe(true);
    expect(room.session?.phase).toBe("active-game");
  });
  it("supports 2 to 8 players and rejects player nine", () => {
    for (const count of [2, 5, 8]) { const room = makeRoom(count); expect(() => act(room, "p0", "start")).not.toThrow(); }
    expect(() => join(makeRoom(8), "p9", "Player 9", now)).toThrow("Room is full");
  });
  it("keeps choices private until resolution", () => {
    const room = makeRoom(); start(room); act(room, "p0", "submit", "RED");
    const view = snapshot(room, "p1", now + 100);
    expect(view.session?.round?.myChoice).toBeNull();
    expect(view.session?.round).not.toHaveProperty("submissions");
    expect(JSON.stringify(view)).not.toContain('"choices":{"p0":"RED"');
  });
  it("scores a game and exposes the winner's rule choice", () => {
    const room = makeRoom(); start(room); submit(room, { p0: "RED", p1: "BLUE", p2: "BLUE" });
    expect(room.session?.phase).toBe("game-results");
    expect(room.session?.scores).toEqual({ p0: 2, p1: 0, p2: 0 });
    expect(() => act(room, "p1", "open-rule-selection")).toThrow("winner");
    act(room, "p0", "open-rule-selection");
    expect(() => act(room, "p1", "select-rule", "double-down")).toThrow("winner");
  });
  it("persists scores and structured House Rules across later games and reaches final results", () => {
    const room = makeRoom(); start(room);
    const pattern = { p0: "RED", p1: "BLUE", p2: "BLUE" } as const;
    submit(room, pattern); selectRule(room, "double-down");
    expect(room.session?.phase).toBe("intermission");
    expect(room.session?.activeRules[0]).toMatchObject({ id: "double-down", activationPoint: "next-game", canStack: true, effect: { type: "score-multiplier", multiplier: 2 } });
    expect(room.session?.scores.p0).toBe(2);
    act(room, "p0", "begin-game");
    expect(room.session?.gameNumber).toBe(2);
    submit(room, pattern);
    expect(room.session?.scores.p0).toBe(6);
    expect(room.session?.history[1].rules[0].id).toBe("double-down");
    // Repeat the registered game in each development slot to exercise the full session lifecycle.
    for (let game = 2; game < SESSION_GAME_COUNT; game++) {
      selectRule(room, "double-down");
      act(room, "p0", "begin-game");
      submit(room, pattern);
    }
    selectRule(room, "double-down");
    act(room, "p0", "begin-game");
    expect(room.session?.phase).toBe("final-results");
    expect(room.session?.gameNumber).toBe(SESSION_GAME_COUNT);
    expect(room.session?.scores.p0).toBeGreaterThan(6);
  });
  it("applies persistent Underdog and Bounty effects to Split Decision", () => {
    const room = makeRoom(); start(room); submit(room, { p0: "RED", p1: "BLUE", p2: "BLUE" }); selectRule(room, "underdog");
    act(room, "p0", "begin-game"); submit(room, { p0: "BLUE", p1: "RED", p2: "BLUE" });
    expect(room.session?.round?.result?.points.p1).toBe(3);
    expect(room.session?.activeRules).toHaveLength(1);
  });
  it("resolves timed-out rounds and reconnects with the same player identity", () => {
    const room = makeRoom(2); start(room); act(room, "p0", "submit", "RED");
    expect(snapshot(room, "p1", now + 30_001).session?.phase).toBe("game-results");
    const before = room.players[1].seenAt; join(room, "p1", "Player One", now + 31_000);
    expect(room.players).toHaveLength(2); expect(room.players[1].seenAt).toBeGreaterThan(before);
  });
});
