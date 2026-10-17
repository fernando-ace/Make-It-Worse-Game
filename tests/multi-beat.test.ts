import { describe, expect, it } from "vitest";
import { apply, MINIGAMES, snapshot, HOUSE_RULES } from "../lib/engine";
import { ENCOUNTER_GAMES } from "../lib/games/encounters";
import { advanceObjectives } from "../lib/objectives";
import { partyMetrics } from "../lib/party-metrics";
import type { Action, HouseRule, Room } from "../lib/types";
let sequence = 0;
const startTime = 1_000_000;
function setup(id: string, count = 3, rules: HouseRule[] = []) {
  const room: Room = { id: "room", code: "ABC234", hostId: "p0", revision: 0, createdAt: startTime, players: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Name-${i}`, seenAt: startTime })), session: null, processed: [] };
  apply(room, "p0", { type: "start" }, startTime, `start-${++sequence}`);
  const session = room.session!;
  session.seed = "encounter-test"; session.gameSlots[0] = id;
  session.gameConfig = MINIGAMES[id].config({ players: room.players, gameNumber: 1 });
  session.activeRules = rules;
  apply(room, "p0", { type: "begin-game" }, startTime, `begin-${++sequence}`);
  return room;
}
function act(room: Room, uid: string, action: Action, now = startTime + 1, actionId = `action-${++sequence}`) {
  apply(room, uid, action, now, actionId);
}
function fill(room: Room, choices?: string[]) {
  const round = room.session!.round!;
  const ids = round.firstCommitPlayerId ? [round.firstCommitPlayerId, ...room.players.map(p => p.id).filter(id => id !== round.firstCommitPlayerId)] : room.players.map(p => p.id);
  for (const id of ids) act(room, id, { type: "submit", value: choices?.[room.players.findIndex(p => p.id === id)] ?? round.config.options[0].id, beat: round.beat?.index });
}

describe("two-beat server state machine", () => {
  it.each(ENCOUNTER_GAMES.map(g => g.id))("preserves %s commitments and reconnects privately at every beat", id => {
    const room = setup(id), round = room.session!.round!;
    const firstChoice = round.config.options[0].id;
    act(room, "p0", { type: "submit", value: firstChoice, beat: 0 }, startTime + 1, "same-request");
    const own = snapshot(room, "p0", startTime + 2), other = snapshot(room, "p1", startTime + 2);
    expect(own.session!.round!.myChoice).toBe(firstChoice);
    expect(other.session!.round!.myChoice).toBeNull();
    expect(other.session!.round!.beat!.publicLines).toEqual([]);
    expect(other.session!.round).not.toHaveProperty("submissions");
    act(room, "p1", { type: "submit", value: firstChoice, beat: 0 });
    act(room, "p2", { type: "submit", value: firstChoice, beat: 0 });
    expect(round.beat!.index).toBe(1);
    expect(round.result).toBeNull();
    expect(room.session!.history).toHaveLength(0);
    expect(round.beat!.firstChoices.p0).toBe(firstChoice);
    expect(snapshot(room, "p0", startTime + 2).session!.round!.beat!.myFirstChoice).toBe(firstChoice);
    const beforeRetry = structuredClone(round);
    act(room, "p0", { type: "submit", value: firstChoice, beat: 0 }, startTime + 2, "same-request");
    expect(round).toEqual(beforeRetry);
    expect(() => act(room, "p0", { type: "submit", value: round.config.options[0].id, beat: 0 })).toThrow("beat changed");
    expect(() => act(room, "p0", { type: "submit", value: firstChoice, beat: 1 })).toThrow("options shown");
    fill(room);
    expect(room.session!.phase).toBe("game-results");
    expect(room.session!.history).toHaveLength(1);
    const scores = { ...room.session!.scores };
    snapshot(room, "p0", startTime + 100000);
    expect(room.session!.scores).toEqual(scores);
  });

  it.each(ENCOUNTER_GAMES.map(g => g.id))("expires both beats of %s with no invented actions or points", id => {
    const room = setup(id), round = room.session!.round!;
    snapshot(room, "p0", startTime + 200000);
    expect(room.session!.phase).toBe("game-results");
    expect(round.beat!.firstChoices).toEqual({});
    expect(round.submissions).toEqual({});
    expect(round.result!.basePoints).toEqual({ p0: 0, p1: 0, p2: 0 });
    expect(round.result!.events.filter(e => !["round-score", "power"].includes(e.type))).toEqual([]);
  });

  it("opens beat two at the original deadline after late sync, with no time extension", () => {
    const room = setup("cross-my-heart"), round = room.session!.round!, deadline = round.deadlineAt;
    snapshot(room, "p0", deadline + 5000);
    expect(round.startedAt).toBe(deadline);
    expect(round.deadlineAt).toBe(deadline + 40000);
    expect(round.beat!.index).toBe(1);
  });

  it("filters witness reports and seed for every viewer", () => {
    const room = setup("signal-noise"); fill(room);
    const round = room.session!.round!;
    const witnessId = Object.entries(round.beat!.privateHints).find(([,hint]) => hint.startsWith("YOU ARE"))![0];
    for (const player of room.players) {
      const view = snapshot(room, player.id, startTime + 2);
      expect(view.session).not.toHaveProperty("seed");
      expect(view.session!.round!.beat).not.toHaveProperty("privateHints");
      expect(view.session!.round!.beat).not.toHaveProperty("firstChoices");
      expect(view.session!.round!.beat!.myHint!.includes("True route:")).toBe(player.id === witnessId);
    }
  });

  it("applies negotiation time to both beats and compatible promise consequences after multipliers", () => {
    const rules: HouseRule[] = [
      { ...HOUSE_RULES.find(r => r.id === "binding-promises")!, effect: { type: "binding-promises" } },
      { ...HOUSE_RULES.find(r => r.id === "breathing-room")!, effect: { type: "breathing-room" } },
    ];
    const room = setup("cross-my-heart", 2, rules), round = room.session!.round!;
    expect(round.deadlineAt - round.startedAt).toBe(45000);
    fill(room, ["promise:left", "promise:left"]);
    expect(round.deadlineAt - round.startedAt).toBe(55000);
    fill(room, ["route:left", "route:right"]);
    expect(round.result!.basePoints).toEqual({ p0: 4, p1: 3 });
    expect(round.result!.points).toEqual({ p0: 6, p1: 2 });
    expect(round.result!.reasons.p1).toContain("Your Word Matters -1");
  });

  it("records broken promises for behavioral objectives without revealing them", () => {
    const room = setup("cross-my-heart", 2);
    room.session!.objectives.p0 = { id: "promise-breaker", title: "SECRET TEXT", description: "SECRET TEXT", progress: 0, target: 1, completed: false, reward: 4 };
    fill(room, ["promise:left", "promise:left"]);
    fill(room, ["route:right", "route:left"]);
    expect(room.session!.objectives.p0.completed).toBe(true);
    expect(JSON.stringify(snapshot(room, "p1", startTime + 2))).not.toContain("SECRET TEXT");
    const state = structuredClone(room.session!.objectives);
    advanceObjectives(state, room.session!.round!.result!.events, "cross-my-heart");
    expect(state.p0.progress).toBe(1);
  });

  it("emits only explicit aggregate telemetry with no names, choices, reports or objective text", () => {
    const room = setup("signal-noise"), before = structuredClone(room);
    fill(room); const between = structuredClone(room); fill(room);
    const metrics = partyMetrics(between, room)!;
    expect(metrics.completed).toBe(1);
    expect(partyMetrics(before, between)!.beatTransition).toBe(1);
    const text = JSON.stringify(metrics);
    for (const forbidden of ["Name-", "cargo:", "claim:", "YOU ARE", "description", "targetId", "actorId", "p0", "encounter-test", "privateHints", "powerOffers"]) expect(text).not.toContain(forbidden);
    expect(partyMetrics(room, room)).toBeNull();
  });

  it("keeps a legal action at both beats for every player count", () => {
    for (let count = 2; count <= 8; count++) for (const game of ENCOUNTER_GAMES) {
      const room = setup(game.id, count);
      for (let beat = 0; beat < 2; beat++) {
        for (const player of room.players) expect(room.session!.round!.config.options.some(o => game.validate(o.id, { players: room.players, playerId: player.id, config: room.session!.round!.config }))).toBe(true);
        fill(room);
      }
      expect(room.session!.phase).toBe("game-results");
    }
  });
});

describe("existing game deadline and accuracy repairs", () => {
  it.each(["pile-on", "bluff-check", "prisoners-dilemma", "split-the-difference"])("does not reward absent players in %s", id => {
    const room = setup(id); snapshot(room, "p0", startTime + 100000);
    expect(room.session!.round!.result!.basePoints).toEqual({ p0: 0, p1: 0, p2: 0 });
  });
  it("requires a strict majority for the Group Tab", () => {
    const room = setup("group-tab", 2); fill(room, ["share", "grab"]);
    expect(room.session!.round!.result!.basePoints.p0).toBe(0);
  });
});
