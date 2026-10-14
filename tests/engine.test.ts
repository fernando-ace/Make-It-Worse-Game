import { describe, expect, it } from "vitest";
import { apply, join, MINIGAMES, registerMinigame, selectSessionGames, SESSION_GAME_COUNT, snapshot } from "../lib/engine";
import { resolveAwards } from "../lib/games";
import type { GameEvent, HouseRule, MinigameDefinition, MinigameResolution, Room } from "../lib/types";

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
function submissions(room: Room, choices: Record<string, string>) {
  const first = room.session?.round?.firstCommitPlayerId;
  const entries = Object.entries(choices).sort(([a], [b]) => a === first ? -1 : b === first ? 1 : 0);
  for (const [id, choice] of entries) act(room, id, "submit", choice);
}

describe("authoritative party session engine", () => {
  it("starts six distinct registry games in a deterministic seeded order", () => {
    const room = makeRoom(); start(room);
    expect(selectSessionGames("same-seed")).toEqual(selectSessionGames("same-seed"));
    expect(selectSessionGames("same-seed")).not.toEqual(selectSessionGames("other-seed"));
    expect(room.session?.gameSlots).toHaveLength(SESSION_GAME_COUNT);
    expect(new Set(room.session?.gameSlots).size).toBe(SESSION_GAME_COUNT);
    expect(Object.keys(MINIGAMES).length).toBeGreaterThanOrEqual(16);
    expect(Object.values(MINIGAMES).every((game) => game.director?.expectedSeconds && game.director.minPlayers === 2 && game.director.maxPlayers === 8 && game.director.houseRuleTags.length > 0)).toBe(true);
    expect(room.session?.gameSlots.every((id) => MINIGAMES[id].interaction)).toBe(true);
    expect(MINIGAMES[room.session!.gameSlots[0]].difficulty).toBe(1);
    expect(MINIGAMES[room.session!.gameSlots.at(-1)!].finaleSuitable).toBe(true);
    expect(Object.keys(MINIGAMES)).toEqual(expect.arrayContaining(["split-decision", "make-it-worse", "trust-me", "pile-on", "secret-handshake", "hot-potato"]));
    expect(Object.keys(MINIGAMES)).toEqual(expect.arrayContaining(["auction-house", "lifeline", "group-project", "prisoners-dilemma", "split-the-difference", "golden-ticket"]));
    expect(room.session?.phase).toBe("active-game");
  });
  it("directs diverse, paced sessions across 1,000 seeds and every supported player count", () => {
    const lineups = new Set<string>();
    for (let count = 2; count <= 8; count++) for (let seed = 0; seed < 125; seed++) {
      const lineup = selectSessionGames(`director:${count}:${seed}`);
      const games = lineup.map((id) => MINIGAMES[id]);
      expect(lineup).toHaveLength(SESSION_GAME_COUNT);
      expect(new Set(lineup).size).toBe(SESSION_GAME_COUNT);
      expect(games[0].director?.socialIntensity).toBe(1);
      expect(games[5].finaleSuitable).toBe(true);
      expect(new Set(games.map((game) => game.director?.family)).size).toBeGreaterThanOrEqual(4);
      expect(games.every((game) => game.director && game.director.minPlayers <= count && game.director.maxPlayers >= count)).toBe(true);
      expect(games.slice(1).every((game, index) => game.director?.family !== games[index].director?.family)).toBe(true);
      lineups.add(lineup.join("|"));
    }
    expect(lineups.size).toBeGreaterThan(100);
  }, 30000);
  it("keeps the registry open for new compatible definitions without replacing IDs", () => {
    const definition: MinigameDefinition = { id: "audit-test-game", displayName: "Test", instructions: "Choose.", options: () => [{ id: "A", label: "A" }], config: ({ players, gameNumber }) => ({ title: "Pick", prompt: "Choose", options: [{ id: "A", label: "A" }], scoreHint: "One point", promptId: `${players.length}-${gameNumber}` }), validate: (choice) => choice === "A", resolve: ({ players, submissions }) => ({ choices: submissions, basePoints: Object.fromEntries(players.map((p) => [p.id, 1])), reasons: Object.fromEntries(players.map((p) => [p.id, "Picked A"])), events: [], reveal: "A wins" }) };
    registerMinigame(definition);
    expect(MINIGAMES[definition.id]).toBe(definition);
    expect(selectSessionGames("same-seed")).toHaveLength(SESSION_GAME_COUNT);
    expect(new Set(selectSessionGames("same-seed")).size).toBe(SESSION_GAME_COUNT);
    expect(() => registerMinigame(definition)).toThrow("already registered");
  });
  it("supports 2 to 8 players and rejects outsiders", () => {
    for (const count of [2, 5, 8]) expect(() => act(makeRoom(count), "p0", "start")).not.toThrow();
    expect(() => act(makeRoom(8), "p9", "sync")).toThrow("Not a room member");
  });
  it("keeps each game's submitted action private and restores only the reconnecting player's choice", () => {
    for (const gameId of Object.keys(MINIGAMES)) {
      const room = makeRoom(); setGame(room, gameId);
      const definition = MINIGAMES[gameId];
      const choice = room.session!.round!.config.options.find((option) => definition.validate(option.id, { players: room.players, playerId: "p0", config: room.session!.round!.config }))!.id;
      act(room, "p0", "submit", choice);
      const view = snapshot(room, "p1", now + 100);
      expect(view.session?.round?.myChoice).toBeNull();
      expect(view.session?.round).not.toHaveProperty("submissions");
      expect(JSON.stringify(view.session?.round)).not.toContain('"p0":"');
      expect(snapshot(room, "p0", now + 200).session?.round?.myChoice).toBe(choice);
      submissions(room, Object.fromEntries(["p1", "p2"].map((playerId) => [playerId, room.session!.round!.config.options.find((option) => definition.validate(option.id, { players: room.players, playerId, config: room.session!.round!.config }))!.id])));
      expect(snapshot(room, "p0", now + 300).session?.round?.result).toEqual(snapshot(room, "p1", now + 300).session?.round?.result);
    }
  });
  it.each(Object.keys(MINIGAMES))("rejects invalid and duplicate actions for %s", (gameId) => {
    const room = makeRoom(); setGame(room, gameId);
    expect(() => act(room, "p0", "submit", "forged-action")).toThrow("options shown");
    const choice = room.session!.round!.config.options.find((option) => MINIGAMES[gameId].validate(option.id, { players: room.players, playerId: "p0", config: room.session!.round!.config }))!.id;
    const reusedId = `same-action-${gameId}`;
    act(room, "p0", "submit", choice, now, reusedId);
    act(room, "p0", "submit", "forged-action", now, reusedId);
    expect(room.session?.round?.submissions.p0).toBe(choice);
    expect(() => act(room, "p0", "submit", choice)).toThrow("already locked");
  });
  it("scores Split Decision by reading the minority", () => {
    const room = makeRoom(); setGame(room, "split-decision"); submissions(room, { p0: "RED", p1: "BLUE", p2: "BLUE" });
    expect(room.session?.round?.result?.points).toEqual({ p0: 2, p1: -1, p2: -1 });
    expect(room.session?.round?.result?.events).toContainEqual({ type: "read", playerId: "p0", accurate: true });
    expect(room.session?.round?.result?.events).toContainEqual({ type: "read", playerId: "p1", accurate: false });
    expect(room.session?.round?.result?.reveal).toBe("RED was the minority.");
  });
  it("uses structured scenario data and rewards the Make It Worse crowd read", () => {
    const room = makeRoom(); setGame(room, "make-it-worse", 2);
    expect(room.session?.gameConfig.promptId).toBe("wedding-toast");
    const options = room.session!.gameConfig.options;
    submissions(room, { p0: options[0].id, p1: options[1].id, p2: options[1].id });
    expect(room.session?.round?.result?.points).toEqual({ p0: -1, p1: 2, p2: 2 });
    expect(room.session?.round?.result?.events).toContainEqual({ type: "read", playerId: "p1", accurate: true });
    expect(room.session?.round?.result?.reveal).toContain(options[1].label);
  });
  it("makes Trust Me's pool, safe point, gamble, and betrayal resolve together", () => {
    const room = makeRoom(4); setGame(room, "trust-me");
    submissions(room, { p0: "pool", p1: "swipe", p2: "pocket", p3: "risk" });
    expect(room.session?.round?.result?.basePoints).toEqual({ p0: 0, p1: 2, p2: 1, p3: -1 });
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
  it("makes Secret Handshake reward mutual trust and expose a one-sided pact", () => {
    const room = makeRoom(); setGame(room, "secret-handshake");
    submissions(room, { p0: "reach:p1", p1: "reach:p0", p2: "reach:p0" });
    expect(room.session?.round?.result?.basePoints).toEqual({ p0: 4, p1: 3, p2: -1 });
    expect(room.session?.round?.result?.events).toContainEqual({ type: "alliance", playerId: "p0", targetId: "p1", mutual: true });
    expect(room.session?.round?.result?.events).toContainEqual({ type: "betrayed", playerId: "p0", targetId: "p2" });
  });
  it("makes Hot Potato passes depend on the recipient and tracks who took the heat", () => {
    const room = makeRoom(); setGame(room, "hot-potato");
    submissions(room, { p0: "pass:p1", p1: "pass:p2", p2: "hold" });
    expect(room.session?.round?.result?.basePoints).toEqual({ p0: 2, p1: 0, p2: 0 });
    expect(room.session?.round?.result?.reasons.p2).toContain("−1");
    expect(room.session?.round?.result?.events).toContainEqual({ type: "betrayed", playerId: "p2", targetId: "p1" });
  });
  it("makes a pass-back a failed escape", () => {
    const room = makeRoom(2); setGame(room, "hot-potato");
    submissions(room, { p0: "pass:p1", p1: "pass:p0" });
    expect(room.session?.round?.result?.basePoints).toEqual({ p0: 0, p1: 0 });
    expect(room.session?.round?.result?.reasons.p0).toContain("sent it straight back");
  });
  it.each(Object.keys(MINIGAMES))("resolves %s deterministically", (gameId) => {
    const first = makeRoom(); const second = makeRoom();
    const number = gameId === "make-it-worse" ? 2 : 1;
    setGame(first, gameId, number); setGame(second, gameId, number);
    const definition = MINIGAMES[gameId];
    for (const room of [first, second]) submissions(room, Object.fromEntries(room.players.map((player) => [player.id, room.session!.round!.config.options.find((option) => definition.validate(option.id, { players: room.players, playerId: player.id, config: room.session!.round!.config }))!.id])));
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
    expect(room.session?.round?.result?.points).toEqual({ p0: -2, p1: 7, p2: 6 });
    expect(room.session?.round?.result?.modifiers.p1).toEqual(["Double Down ×2: 2 → 4", "Underdog +1", "Bounty +2"]);
  });
  it("enforces first commitment and applies a targeted loss shield server-side", () => {
    const room = makeRoom(); setGame(room, "hot-potato", 2);
    room.session!.activeRules = [
      { id: "first-commit", name: "First on the Record", description: "Commit first.", activationPoint: "next-game", canStack: false, effect: { type: "forced-first", playerId: "p2" } },
      { id: "safety-net", name: "Soft Landing", description: "Cannot lose points.", activationPoint: "next-game", canStack: false, effect: { type: "score-floor", playerId: "p0" } },
    ];
    room.session!.phase = "game-intro";
    act(room, "p0", "begin-game");
    expect(() => act(room, "p1", "submit", "pass:p0")).toThrow("commit first");
    act(room, "p2", "submit", "pass:p0");
    act(room, "p0", "submit", "hold");
    act(room, "p1", "submit", "pass:p0");
    expect(room.session?.round?.result?.basePoints.p0).toBe(-1);
    expect(room.session?.round?.result?.points.p0).toBe(0);
    expect(room.session?.round?.result?.modifiers.p0).toContain("Soft Landing +1");
    expect(snapshot(room, "p1", now + 1).session?.round?.firstCommitPlayerId).toBe("p2");
  });
  it("gives game six a modest earned-only comeback bonus without replacing session scores", () => {
    const room = makeRoom(5); setGame(room, "split-decision", 6);
    room.session!.scores = { p0: 8, p1: 6, p2: 5, p3: 3, p4: 3 };
    submissions(room, { p0: "RED", p1: "RED", p2: "RED", p3: "BLUE", p4: "BLUE" });
    expect(room.session?.round?.result?.basePoints).toEqual({ p0: -1, p1: -1, p2: -1, p3: 2, p4: 2 });
    expect(room.session?.round?.result?.points).toEqual({ p0: -1, p1: -1, p2: -1, p3: 7, p4: 7 });
    expect(room.session?.round?.result?.modifiers.p3).toContain("Finale round leader +3");
    expect(room.session?.round?.result?.modifiers.p3).toContain("Finale comeback +2");
    expect(room.session?.round?.result?.modifiers.p4).toContain("Finale comeback +2");
    expect(room.session?.scores).toEqual({ p0: 7, p1: 5, p2: 4, p3: 10, p4: 10 });
  });
  it("makes chaos moves earn a visible one-point stake in game five", () => {
    const room = makeRoom(4); setGame(room, "trust-me", 5);
    submissions(room, { p0: "pool", p1: "swipe", p2: "pocket", p3: "pocket" });
    const result = room.session?.round?.result;
    expect(result?.basePoints.p1).toBe(2);
    expect(result?.points.p1).toBe(3);
    expect(result?.modifiers.p1).toContain("Game 5 chaos +1");
    expect(result?.reasons.p1).toContain("Game 5 chaos +1");
  });
  it.each(["split-decision", "make-it-worse", "trust-me", "pile-on", "secret-handshake", "hot-potato"])("gives %s a game-five chaos interaction", (gameId) => {
    const room = makeRoom(4); setGame(room, gameId, 5);
    const config = room.session!.round!.config;
    const disruptivePlayer = gameId === "trust-me" ? "p1" : gameId === "hot-potato" ? "p3" : "p0";
    const choicesByGame: Record<string, Record<string, string>> = {
      "split-decision": { p0: "RED", p1: "RED", p2: "RED", p3: "BLUE" },
      "make-it-worse": { p0: config.options[0].id, p1: config.options[1].id, p2: config.options[1].id, p3: config.options[1].id },
      "trust-me": { p0: "pool", p1: "swipe", p2: "pocket", p3: "pocket" },
      "pile-on": { p0: "target:p3", p1: "target:p0", p2: "target:p0", p3: "cash" },
      "secret-handshake": { p1: "reach:p2", p0: "reach:p1", p2: "reach:p3", p3: "solo" },
      "hot-potato": { p1: "pass:p0", p0: "hold", p2: "pass:p0", p3: "pass:p2" },
    };
    const choices = choicesByGame[gameId];
    submissions(room, choices);
    const result = room.session!.round!.result!;
    expect(result.events).toContainEqual({ type: "chaos", playerId: disruptivePlayer });
    expect(result.modifiers[disruptivePlayer]).toContain("Game 5 chaos +1");
    expect(result.reasons[disruptivePlayer]).toContain("Game 5 chaos +1");
  });
  it("credits betrayal awards to the perpetrator and the player who was betrayed", () => {
    const players = makeRoom().players;
    const events: GameEvent[] = [
      { type: "betrayed", playerId: "p0", targetId: "p1" },
      { type: "betrayal", playerId: "p2" },
    ];
    const result = { events } as MinigameResolution;
    const awards = resolveAwards([{ result }], players);
    expect(awards.find((award) => award.id === "most-betrayed")?.playerId).toBe("p0");
    expect(awards.find((award) => award.id === "worst-ally")?.playerId).toBe("p2");
  });
  it.each([
    ["split-decision", { p1: "RED", p0: "RED", p2: "RED", p3: "BLUE" }],
    ["make-it-worse", { p1: "wedding-toast-1", p0: "wedding-toast-0", p2: "wedding-toast-1", p3: "wedding-toast-1" }],
    ["trust-me", { p1: "pool", p0: "risk", p2: "swipe", p3: "pocket" }],
    ["pile-on", { p1: "target:p0", p0: "target:p3", p2: "target:p0", p3: "cash" }],
    ["secret-handshake", { p1: "reach:p2", p0: "reach:p1", p2: "reach:p3", p3: "solo" }],
    ["hot-potato", { p1: "pass:p0", p0: "hold", p2: "pass:p0", p3: "pass:p2" }],
  ] as const)("lets multiple House Rules change %s", (gameId, choices) => {
    const room = makeRoom(4); setGame(room, gameId, 2);
    const activeRules: HouseRule[] = [
      { id: "double-down", name: "Double Down", description: "Double scores.", activationPoint: "next-game", canStack: true, effect: { type: "score-multiplier", multiplier: 2 } },
      { id: "underdog", name: "Underdog", description: "Last place gets extra.", activationPoint: "next-game", canStack: false, effect: { type: "last-place-bonus", points: 1 } },
      { id: "bounty", name: "Bounty", description: "Beat the mark.", activationPoint: "next-game", canStack: false, effect: { type: "bounty", points: 2, targetId: "p0" } },
      { id: "first-commit", name: "First on the Record", description: "Commit first.", activationPoint: "next-game", canStack: false, effect: { type: "forced-first", playerId: "p1" } },
      { id: "safety-net", name: "Soft Landing", description: "Cannot lose points.", activationPoint: "next-game", canStack: false, effect: { type: "score-floor", playerId: "p0" } },
    ];
    room.session!.scores = { p0: 10, p1: 7, p2: 5, p3: 0 };
    room.session!.activeRules = activeRules;
    room.session!.round = null;
    room.session!.phase = "game-intro";
    act(room, "p0", "begin-game");
    expect(room.session!.round!.firstCommitPlayerId).toBe("p1");
    expect(() => act(room, "p0", "submit", choices.p0)).toThrow("commit first");
    submissions(room, choices);
    const result = room.session!.round!.result!;
    expect(result.basePoints.p0).toBe(-1);
    expect(result.points.p0).toBe(0);
    expect(result.modifiers.p0).toContain("Soft Landing +1");
    expect(result.modifiers.p3).toContain(`Double Down ×2: ${result.basePoints.p3} → ${result.basePoints.p3 * 2}`);
    expect(result.modifiers.p3).toContain("Underdog +1");
    expect(result.modifiers.p3).toContain("Bounty +2");
    expect(result.points.p3).toBe(result.basePoints.p3 * 2 + 3);
  });
  it("persists scores and rules across the session and derives awards only from recorded events", () => {
    const room = makeRoom(); setGame(room, "split-decision");
    room.session!.gameSlots = Array(SESSION_GAME_COUNT).fill("split-decision");
    submissions(room, { p0: "RED", p1: "BLUE", p2: "BLUE" }); selectRule(room, "double-down");
    for (let game = 2; game <= 6; game++) {
      act(room, "p0", "continue-session"); act(room, "p0", "begin-game");
      const gameId = room.session!.round!.minigameId;
      const choices = gameId === "pile-on"
        ? { p0: "cash", p1: "target:p0", p2: "target:p0" }
        : Object.fromEntries(room.players.map((player) => [player.id, room.session!.round!.config.options.find((option) => MINIGAMES[gameId].validate(option.id, { players: room.players, playerId: player.id, config: room.session!.round!.config }))!.id]));
      submissions(room, choices);
      const nextRule = room.session!.offeredRules.find((rule) => rule.id === "double-down")?.id ?? room.session!.offeredRules[0].id;
      selectRule(room, nextRule);
    }
    expect(room.session?.history.map((item) => item.minigameId)).toEqual(room.session?.gameSlots);
    expect(room.session?.history[1].rules).toHaveLength(1);
    expect(Object.values(room.session!.round!.result!.modifiers).flat().some((modifier) => modifier.startsWith("Double Down ×4:"))).toBe(true);
    act(room, "p0", "continue-session");
    expect(room.session?.phase).toBe("final-results");
    expect(room.session?.awards.some((award) => award.id === "best-read")).toBe(true);
    const recordedBetrayals = room.session!.history.flatMap((game) => game.result.events).some((event) => event.type === "betrayal" || event.type === "betrayed");
    expect(room.session?.awards.some((award) => award.id === "worst-ally")).toBe(recordedBetrayals);
  });
  it("enforces winner-only House Rule selection", () => {
    const room = makeRoom(); setGame(room, "split-decision"); submissions(room, { p0: "RED", p1: "BLUE", p2: "BLUE" });
    expect(() => act(room, "p1", "open-rule-selection")).toThrow("winner");
    act(room, "p0", "open-rule-selection");
    expect(() => act(room, "p1", "select-rule", "double-down")).toThrow("winner");
  });
  it("resolves timed out rounds and reconnects with the same identity", () => {
    const room = makeRoom(2); setGame(room, "split-decision"); act(room, "p0", "submit", "RED");
    expect(snapshot(room, "p1", now + 46_000).session?.phase).toBe("game-results");
    const before = room.players[1].seenAt; join(room, "p1", "Player One", now + 47_000);
    expect(room.players).toHaveLength(2); expect(room.players[1].seenAt).toBeGreaterThan(before);
  });
  it("privately restores objectives and power balances while hiding other players' private state", () => {
    const room = makeRoom(); setGame(room, "split-decision");
    const owner = snapshot(room, "p0", now + 1).session!;
    const other = snapshot(room, "p1", now + 2).session!;
    expect(owner.myObjective).toEqual(room.session!.objectives.p0);
    expect(owner.myChaos).toBe(2);
    expect(other).not.toHaveProperty("objectives");
    expect(other).not.toHaveProperty("chaos");
    expect(other).not.toHaveProperty("seed");
    expect(other.objectiveReveal).toBeUndefined();
    act(room, "p0", "use-power", "guard");
    expect(snapshot(room, "p0", now + 3).session?.myChaos).toBe(0);
    expect(snapshot(room, "p0", now + 3).session?.myPowers).toHaveLength(1);
    expect(snapshot(room, "p1", now + 3).session?.myPowers).toEqual([]);
    expect(snapshot(room, "p1", now + 3).session?.myChaos).toBe(2);
    expect(() => act(room, "p0", "use-power", "amplify")).toThrow("already used");
  });
  it("applies powers after House Rules and prevents duplicate or unaffordable spending", () => {
    const room = makeRoom(); setGame(room, "split-decision", 2);
    room.session!.activeRules = [{ id: "double-down", name: "Double Down", description: "Double scores.", activationPoint: "next-game", canStack: true, effect: { type: "score-multiplier", multiplier: 2 } }];
    act(room, "p0", "use-power", "guard");
    expect(() => act(room, "p0", "use-power", "guard", now, "guard-again" )).toThrow("already used");
    room.session!.chaos.p1 = 1;
    expect(() => act(room, "p1", "use-power", "bounty:p0", now, "poor-bounty")).toThrow("Not enough Chaos");
    submissions(room, { p0: "RED", p1: "RED", p2: "BLUE" });
    expect(room.session?.round?.result?.basePoints.p0).toBe(-1);
    expect(room.session?.round?.result?.points.p0).toBe(0);
    expect(room.session?.round?.result?.modifiers.p0).toContain("Double Down ×2: -1 → -2");
    expect(room.session?.round?.result?.modifiers.p0).toContain("Soft Landing power +2");
    expect(room.session?.round?.result?.events).toContainEqual({ type: "power", playerId: "p0", powerId: "guard" });
    expect(room.session?.chaos.p0).toBe(1);
  });
  it("tracks low-score and power objectives from resolved round events", () => {
    const room = makeRoom(); setGame(room, "trust-me", 2);
    room.session!.objectives.p0 = { id: "quiet-climber", title: "Quiet Climber", description: "Score below the high score.", progress: 0, target: 2, completed: false, reward: 4 };
    room.session!.objectives.p2 = { id: "power-player", title: "Spend with Purpose", description: "Use powers.", progress: 0, target: 2, completed: false, reward: 4 };
    act(room, "p2", "use-power", "amplify");
    submissions(room, { p0: "pocket", p1: "pool", p2: "swipe" });
    expect(room.session?.round?.result?.events).toContainEqual({ type: "round-score", playerId: "p0", points: 1, highest: false });
    expect(room.session?.round?.result?.events.some((event) => event.type === "power" && event.playerId === "p2")).toBe(true);
    expect(room.session?.objectives.p0.progress).toBe(1);
    expect(room.session?.objectives.p2.progress).toBe(1);
  });
  it("reveals completed objectives and awards their bounded bonus once", () => {
    const room = makeRoom(); setGame(room, "split-decision", SESSION_GAME_COUNT);
    const objective = room.session!.objectives.p0;
    objective.progress = objective.target; objective.completed = true;
    const before = room.session!.scores.p0;
    submissions(room, { p0: "RED", p1: "BLUE", p2: "BLUE" });
    selectRule(room, "double-down");
    act(room, "p0", "continue-session");
    const result = snapshot(room, "p1", now + 1).session!;
    expect(result.phase).toBe("final-results");
    expect(result.objectiveReveal?.p0).toMatchObject({ completed: true, reward: 4 });
    expect(room.session?.scores.p0).toBeGreaterThanOrEqual(before + 4);
    expect(() => act(room, "p0", "continue-session", undefined, now, "extra-finalize")).toThrow("intermission");
  });
  it("starts a different, clean six-game run in the same room", () => {
    const room = makeRoom(); setGame(room, "split-decision");
    const oldSlots = [...room.session!.gameSlots];
    room.session!.phase = "final-results";
    room.session!.scores.p0 = 7;
    const oldObjective = room.session!.objectives.p0;
    act(room, "p0", "restart-session");
    expect(room.session?.phase).toBe("game-intro");
    expect(room.session?.gameSlots).toHaveLength(SESSION_GAME_COUNT);
    expect(room.session?.gameSlots).not.toEqual(oldSlots);
    expect(room.session?.scores.p0).toBe(0);
    expect(room.session?.objectives.p0).not.toBe(oldObjective);
    expect(() => act(room, "p1", "restart-session")).toThrow("Only the host");
  });
});
