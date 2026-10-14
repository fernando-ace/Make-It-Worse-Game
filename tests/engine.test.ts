import { describe, expect, it } from "vitest";
import { apply, join, MINIGAMES, snapshot } from "../lib/engine";
import type { Room } from "../lib/types";

const now = 1_000_000;
let actionNumber = 0;
function makeRoom(count = 3): Room {
  const players = Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `Player ${index}`, seenAt: now }));
  return { id: "room-id", code: "ABC234", hostId: "p0", revision: 0, createdAt: now, players, session: null, processed: [] };
}
function act(room: Room, player: string, type: string, value?: string | boolean, time = now) {
  apply(room, player, { type, value }, time, `test-action-${++actionNumber}`);
}
function begin(room: Room) { act(room, "p0", "start"); act(room, "p0", "begin-round"); }
function submit(room: Room, choices: Record<string, "RED" | "BLUE">) { for (const [id, choice] of Object.entries(choices)) act(room, id, "submit", choice); }

describe("party session engine", () => {
  it("keeps the minigame behind a reusable definition and House Rule extension points", () => {
    expect(MINIGAMES["split-decision"]).toMatchObject({ id: "split-decision", displayName: "Split Decision", input: { choices: ["RED", "BLUE"] } });
    expect(MINIGAMES["split-decision"].phases).toContain("round-results");
    expect(MINIGAMES["split-decision"].compatibleHouseRules).toEqual(["underdog", "bounty", "double-down"]);
  });

  it("supports 2 players, ordinary multiplayer, and 8 players, and rejects player 9", () => {
    for (const count of [2, 5, 8]) {
      const room = makeRoom(count);
      expect(room.players).toHaveLength(count);
      expect(() => act(room, "p0", "start")).not.toThrow();
    }
    const full = makeRoom(8);
    expect(() => join(full, "p9", "Player 9", now)).toThrow("Room is full");
  });

  it("rejects starting with fewer than two players and enforces host authority", () => {
    const solo = makeRoom(1);
    expect(() => act(solo, "p0", "start")).toThrow("At least two players");
    const room = makeRoom(2);
    expect(() => act(room, "p1", "start")).toThrow("Only the host");
    act(room, "p0", "start");
    expect(room.session?.phase).toBe("round-intro");
  });

  it("locks submissions and keeps other players' choices hidden until reveal", () => {
    const room = makeRoom(3);
    begin(room);
    act(room, "p0", "submit", "RED");
    const p1View = snapshot(room, "p1", now + 100);
    expect(p1View.session?.round?.myChoice).toBeNull();
    expect(p1View.session?.round?.answeredCount).toBe(1);
    expect(p1View.session?.round).not.toHaveProperty("submissions");
    expect(JSON.stringify(p1View)).not.toContain('"choices":{"p0":"RED"');
    expect(() => act(room, "p0", "submit", "BLUE")).toThrow("already locked");
  });

  it("reveals all choices and awards points to the minority", () => {
    const room = makeRoom(3);
    begin(room);
    submit(room, { p0: "RED", p1: "BLUE", p2: "BLUE" });
    const result = room.session!.round!.result!;
    expect(room.session?.phase).toBe("round-results");
    expect(result.choices).toEqual({ p0: "RED", p1: "BLUE", p2: "BLUE" });
    expect(result.points).toEqual({ p0: 2, p1: 0, p2: 0 });
    expect(result.reasons.p0).toContain("Minority choice");
    expect(snapshot(room, "p1", now).session?.round?.result?.choices).toEqual(result.choices);
  });

  it("gives everyone one point on a color tie", () => {
    const room = makeRoom(2);
    begin(room);
    submit(room, { p0: "RED", p1: "BLUE" });
    expect(room.session!.round!.result!.points).toEqual({ p0: 1, p1: 1 });
    expect(room.session!.round!.result!.reasons.p0).toContain("Color tie");
  });

  it("reveals when the server deadline expires", () => {
    const room = makeRoom(2);
    begin(room);
    act(room, "p0", "submit", "RED");
    expect(snapshot(room, "p1", now + 30_001).session?.phase).toBe("round-results");
    expect(room.session?.round?.result?.choices).toEqual({ p0: "RED" });
    expect(room.session?.round?.result?.reasons.p1).toContain("No choice");
  });

  it("lets only the deterministic round winner select one of three offered rules", () => {
    const room = makeRoom(3);
    begin(room);
    submit(room, { p0: "RED", p1: "BLUE", p2: "BLUE" });
    expect(room.session!.offeredRules).toHaveLength(3);
    expect(room.session!.ruleWinnerId).toBe("p0");
    expect(() => act(room, "p0", "select-rule", "double-down")).toThrow("There is no House Rule");
    act(room, "p0", "open-rule-selection");
    expect(() => act(room, "p1", "select-rule", "double-down")).toThrow("Only this round's winner");
    act(room, "p0", "select-rule", "double-down");
    expect(room.session?.phase).toBe("next-round");
    expect(room.session?.activeRules[0]?.id).toBe("double-down");
    expect(snapshot(room, "p2", now).session?.activeRules[0]?.name).toBe("Double Down");
  });

  it("persists the selected House Rule and changes the next round scoring", () => {
    const room = makeRoom(3);
    begin(room);
    submit(room, { p0: "RED", p1: "BLUE", p2: "BLUE" });
    act(room, "p0", "open-rule-selection");
    act(room, "p0", "select-rule", "double-down");
    act(room, "p0", "begin-round");
    expect(room.session?.activeRules[0]?.id).toBe("double-down");
    submit(room, { p0: "RED", p1: "BLUE", p2: "BLUE" });
    expect(room.session?.round?.result?.points).toEqual({ p0: 4, p1: 0, p2: 0 });
    expect(room.session?.history[1]?.rule?.id).toBe("double-down");
    expect(room.session?.phase).toBe("final-results");
  });

  it("applies the Underdog bonus to the last-place player when they score", () => {
    const room = makeRoom(3);
    begin(room);
    submit(room, { p0: "RED", p1: "BLUE", p2: "BLUE" });
    act(room, "p0", "open-rule-selection");
    act(room, "p0", "select-rule", "underdog");
    act(room, "p0", "begin-round");
    submit(room, { p0: "BLUE", p1: "RED", p2: "BLUE" });
    expect(room.session?.round?.result?.points.p1).toBe(3);
    expect(room.session?.round?.result?.reasons.p1).toContain("Underdog bonus");
  });

  it("persists the Bounty target and awards its bonus when beaten", () => {
    const room = makeRoom(3);
    begin(room);
    submit(room, { p0: "RED", p1: "BLUE", p2: "BLUE" });
    act(room, "p0", "open-rule-selection");
    act(room, "p0", "select-rule", "bounty");
    const target = room.session!.activeRules[0].parameters!.playerId as string;
    act(room, "p0", "begin-round");
    const choices = Object.fromEntries(room.players.map((player) => [player.id, player.id === target ? "BLUE" : "RED"])) as Record<string, "RED" | "BLUE">;
    submit(room, choices);
    const result = room.session!.round!.result!;
    expect(room.session!.history[1].rule?.parameters?.playerId).toBe(target);
    for (const player of room.players.filter((candidate) => candidate.id !== target)) {
      if (result.points[player.id] > 0) expect(result.reasons[player.id]).toContain("Bounty bonus");
    }
  });

  it("supports reconnect by the same identity and rejects cross-room membership", () => {
    const room = makeRoom(2);
    const originalSeenAt = room.players[1].seenAt;
    join(room, "p1", "Player One", now + 500);
    expect(room.players).toHaveLength(2);
    expect(room.players[1].seenAt).toBeGreaterThan(originalSeenAt);
    expect(() => snapshot(room, "outsider", now)).toThrow("Not a room member");
  });

  it("does not award a point to a player who missed a color tie", () => {
    const room = makeRoom(3);
    begin(room);
    submit(room, { p0: "RED", p1: "BLUE" });
    snapshot(room, "p2", now + 30_001);
    expect(room.session?.round?.result?.points).toEqual({ p0: 1, p1: 1, p2: 0 });
    expect(room.session?.round?.result?.reasons.p2).toContain("No choice");
  });
});
