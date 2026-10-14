import { describe, expect, it } from "vitest";
import { apply, DEFAULT_GAME_SLOTS, join, MINIGAMES, registerMinigame, SESSION_GAME_COUNT, snapshot } from "../lib/engine";
import type { MinigameDefinition, Room } from "../lib/types";

const now = 1_000_000;
let actionNumber = 0;
function makeRoom(count = 3): Room {
  const players = Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `Player ${index}`, seenAt: now }));
  return { id: "room-id", code: "ABC234", hostId: "p0", revision: 0, createdAt: now, players, session: null, processed: [] };
}
function act(room: Room, player: string, type: string, value?: string | boolean, time = now, actionId = `test-action-${++actionNumber}`) { apply(room, player, { type, value }, time, actionId); }
function start(room: Room) { act(room, "p0", "start"); act(room, "p0", "begin-game"); }
function selectRule(room: Room, id: string) { act(room, room.session!.ruleWinnerId!, "open-rule-selection"); act(room, room.session!.ruleWinnerId!, "select-rule", id); }
function setGame(room: Room, gameId: string, number = 1) {
  if (!room.session) act(room, "p0", "start");
  room.session!.gameNumber = number;
  room.session!.gameSlots[number - 1] = gameId;
  room.session!.gameConfig = MINIGAMES[gameId].config({ players: room.players, gameNumber: number });
  room.session!.phase = "game-intro";
  act(room, "p0", "begin-game");
}
function submissions(room: Room, choices: Record<string, string>) { for (const [id, choice] of Object.entries(choices)) act(room, id, "submit", choice); }

describe("authoritative party session engine", () => {
  it("starts the configured six-game session with all four social mechanics", () => {
    const room = makeRoom(); start(room);
    expect(DEFAULT_GAME_SLOTS).toEqual(["split-decision", "make-it-worse", "trust-me", "split-decision", "pile-on", "make-it-worse"]);
    expect(room.session?.gameSlots).toHaveLength(SESSION_GAME_COUNT);
    expect(new Set(room.session?.gameSlots).size).toBe(4);
    expect(Object.keys(MINIGAMES)).toEqual(expect.arrayContaining(["split-decision", "make-it-worse", "trust-me", "pile-on"]));
    expect(room.session?.phase).toBe("active-game");
  });
  it("keeps the registry open for new compatible definitions without replacing IDs", () => {
    const definition: MinigameDefinition = { id: "audit-test-game", displayName: "Test", instructions: "Choose.", options: () => [{ id: "A", label: "A" }], config: ({ players, gameNumber }) => ({ title: "Pick", prompt: "Choose", options: [{ id: "A", label: "A" }], scoreHint: "One point", promptId: `${players.length}-${gameNumber}` }), validate: (choice) => choice === "A", resolve: ({ players, submissions }) => ({ choices: submissions, basePoints: Object.fromEntries(players.map((p) => [p.id, 1])), reasons: Object.fromEntries(players.map((p) => [p.id, "Picked A"])), events: [], reveal: "A wins" }) };
    registerMinigame(definition);
    expect(MINIGAMES[definition.id]).toBe(definition);
    expect(() => registerMinigame(definition)).toThrow("already registered");
  });
  it("supports 2 to 8 players and rejects outsiders", () => {
    for (const count of [2, 5, 8]) expect(() => act(makeRoom(count), "p0", "start")).not.toThrow();
    expect(() => act(makeRoom(8), "p9", "sync")).toThrow("Not a room member");
  });
  it("keeps each game's submitted action private and restores only the reconnecting player's choice", () => {
    for (const gameId of Object.keys(MINIGAMES)) {
      const room = makeRoom(); setGame(room, gameId);
      const choice = room.session!.round!.config.options.find((option) => !option.id.startsWith("target:p0"))!.id;
      act(room, "p0", "submit", choice);
      const view = snapshot(room, "p1", now + 100);
      expect(view.session?.round?.myChoice).toBeNull();
      expect(view.session?.round).not.toHaveProperty("submissions");
      expect(JSON.stringify(view.session?.round)).not.toContain('"p0":"');
      expect(snapshot(room, "p0", now + 200).session?.round?.myChoice).toBe(choice);
      const followup = room.session!.round!.config.options.find((option) => !option.id.startsWith("target:"))!.id;
      submissions(room, { p1: followup, p2: followup });
      expect(snapshot(room, "p0", now + 300).session?.round?.result).toEqual(snapshot(room, "p1", now + 300).session?.round?.result);
    }
  });
  it.each(Object.keys(MINIGAMES))("rejects invalid and duplicate actions for %s", (gameId) => {
    const room = makeRoom(); setGame(room, gameId);
    expect(() => act(room, "p0", "submit", "forged-action")).toThrow("options shown");
    const choice = room.session!.round!.config.options.find((option) => !option.id.startsWith("target:p0"))!.id;
    const reusedId = `same-action-${gameId}`;
    act(room, "p0", "submit", choice, now, reusedId);
    act(room, "p0", "submit", "forged-action", now, reusedId);
    expect(room.session?.round?.submissions.p0).toBe(choice);
    expect(() => act(room, "p0", "submit", choice)).toThrow("already locked");
  });
  it("scores Split Decision by reading the minority", () => {
    const room = makeRoom(); start(room); submissions(room, { p0: "RED", p1: "BLUE", p2: "BLUE" });
    expect(room.session?.round?.result?.points).toEqual({ p0: 2, p1: 0, p2: 0 });
    expect(room.session?.round?.result?.reveal).toBe("RED was the minority.");
  });
  it("uses structured scenario data and rewards the Make It Worse crowd read", () => {
    const room = makeRoom(); setGame(room, "make-it-worse", 2);
    expect(room.session?.gameConfig.promptId).toBe("wedding-toast");
    const options = room.session!.gameConfig.options;
    submissions(room, { p0: options[0].id, p1: options[1].id, p2: options[1].id });
    expect(room.session?.round?.result?.points).toEqual({ p0: 0, p1: 2, p2: 2 });
    expect(room.session?.round?.result?.events).toContainEqual({ type: "read", playerId: "p1", accurate: true });
    expect(room.session?.round?.result?.reveal).toContain(options[1].label);
  });
  it("makes Trust Me's pool, safe point, gamble, and betrayal resolve together", () => {
    const room = makeRoom(4); setGame(room, "trust-me");
    submissions(room, { p0: "pool", p1: "swipe", p2: "pocket", p3: "risk" });
    expect(room.session?.round?.result?.basePoints).toEqual({ p0: 0, p1: 2, p2: 1, p3: 0 });
    expect(room.session?.round?.result?.events).toContainEqual({ type: "betrayal", playerId: "p1" });
    expect(room.session?.round?.result?.events).toContainEqual({ type: "gamble", playerId: "p3", result: "lost" });
  });
  it("makes Pile On expose simultaneous targeting, protection, and penalties", () => {
    const room = makeRoom(); setGame(room, "pile-on");
    expect(() => act(room, "p0", "submit", "target:p0")).toThrow("options shown");
    submissions(room, { p0: "target:p1", p1: "shield", p2: "target:p1" });
    expect(room.session?.round?.result?.basePoints).toEqual({ p0: 1, p1: 0, p2: 1 });
    expect(room.session?.round?.result?.events.filter((event) => event.type === "target")).toHaveLength(2);
    expect(room.session?.round?.result?.reveal).toContain("callouts");
  });
  it.each(Object.keys(MINIGAMES))("resolves %s deterministically", (gameId) => {
    const first = makeRoom(); const second = makeRoom();
    const number = gameId === "make-it-worse" ? 2 : 1;
    setGame(first, gameId, number); setGame(second, gameId, number);
    const choice = first.session!.round!.config.options.find((option) => !option.id.startsWith("target:p0"))!.id;
    const other = first.session!.round!.config.options.find((option) => option.id !== choice && !option.id.startsWith("target:p0"))?.id ?? choice;
    for (const [room, values] of [[first, [choice, other, choice]], [second, [choice, other, choice]]] as const) submissions(room, Object.fromEntries(values.map((value, index) => [`p${index}`, value])));
    expect(first.session?.round?.result).toEqual(second.session?.round?.result);
  });
  it("applies persistent House Rules to a game result after its mechanic resolves", () => {
    const room = makeRoom(); setGame(room, "make-it-worse", 2);
    room.session!.scores = { p0: 4, p1: 1, p2: 3 };
    room.session!.activeRules = [
      { id: "double-down", name: "Double Down", description: "Double later game scores.", activationPoint: "next-game", canStack: true, effect: { type: "score-multiplier", multiplier: 2 } },
      { id: "underdog", name: "Underdog", description: "Last place scores extra.", activationPoint: "next-game", canStack: false, effect: { type: "last-place-bonus", points: 1 } },
      { id: "bounty", name: "Bounty", description: "Beat the mark.", activationPoint: "next-game", canStack: false, effect: { type: "bounty", points: 2, targetId: "p0" } },
    ];
    const option = room.session!.round!.config.options[0].id;
    submissions(room, { p0: room.session!.round!.config.options[1].id, p1: option, p2: option });
    expect(room.session?.round?.result?.points).toEqual({ p0: 0, p1: 7, p2: 6 });
    expect(room.session?.round?.result?.modifiers.p1).toEqual(["Double Down ×2: 2 → 4", "Underdog +1", "Bounty +2"]);
  });
  it("persists scores and rules across the session and derives awards only from recorded events", () => {
    const room = makeRoom(); start(room);
    submissions(room, { p0: "RED", p1: "BLUE", p2: "BLUE" }); selectRule(room, "double-down");
    for (let game = 2; game <= 6; game++) {
      act(room, "p0", "continue-session"); act(room, "p0", "begin-game");
      const option = room.session!.round!.config.options[0].id;
      const choices = room.session!.round!.minigameId === "pile-on"
        ? { p0: "cash", p1: "target:p0", p2: "target:p0" }
        : { p0: option, p1: option, p2: option };
      submissions(room, choices);
      selectRule(room, "double-down");
    }
    expect(room.session?.history.map((item) => item.minigameId)).toEqual(DEFAULT_GAME_SLOTS);
    expect(room.session?.history[1].rules).toHaveLength(1);
    expect(room.session?.round?.result?.modifiers.p0).toContain("Double Down ×32: 2 → 64");
    act(room, "p0", "continue-session");
    expect(room.session?.phase).toBe("final-results");
    expect(room.session?.awards.some((award) => award.id === "best-read")).toBe(true);
    expect(room.session?.awards.some((award) => award.id === "worst-ally")).toBe(false);
  });
  it("enforces winner-only House Rule selection", () => {
    const room = makeRoom(); start(room); submissions(room, { p0: "RED", p1: "BLUE", p2: "BLUE" });
    expect(() => act(room, "p1", "open-rule-selection")).toThrow("winner");
    act(room, "p0", "open-rule-selection");
    expect(() => act(room, "p1", "select-rule", "double-down")).toThrow("winner");
  });
  it("resolves timed out rounds and reconnects with the same identity", () => {
    const room = makeRoom(2); start(room); act(room, "p0", "submit", "RED");
    expect(snapshot(room, "p1", now + 46_000).session?.phase).toBe("game-results");
    const before = room.players[1].seenAt; join(room, "p1", "Player One", now + 47_000);
    expect(room.players).toHaveLength(2); expect(room.players[1].seenAt).toBeGreaterThan(before);
  });
});
