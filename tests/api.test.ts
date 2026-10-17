import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Room, Snapshot } from "../lib/types";
import { MINIGAMES } from "../lib/games";
import { POWERS } from "../lib/powers";

const store = vi.hoisted(() => ({ rooms: new Map<string, Room>(), conflicts: 0, betaEvents: [] as Record<string, unknown>[], feedback: [] as Record<string, unknown>[] }));
vi.mock("../lib/server", () => ({
  admin: () => ({
    auth: { getUser: async (token: string) => ({ data: { user: /^(c|p|x|u\d+)$/.test(token) ? { id: token } : null }, error: null }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "cr_create") { const room = args.p_room as Room; store.rooms.set(room.code, structuredClone(room)); return { data: null, error: null }; }
      if (name === "cr_read") { const room = store.rooms.get(args.p_code as string); return { data: room ? { room: structuredClone(room), now: Date.now() } : null, error: null }; }
      if (name === "cr_commit") {
        const room = args.p_room as Room;
        const old = store.rooms.get(room.code)!;
        if (old.revision !== args.p_expected) { store.conflicts++; return { data: false, error: null }; }
        store.rooms.set(room.code, structuredClone(room));
        return { data: true, error: null };
      }
      if (name === "cr_record_beta_events") { store.betaEvents.push(...(args.p_events as Record<string, unknown>[])); return { data: (args.p_events as unknown[]).length, error: null }; }
      if (name === "cr_submit_beta_feedback") {
        if (store.feedback.some((row) => row.p_session_key === args.p_session_key && row.p_respondent_key === args.p_respondent_key)) return { data: false, error: null };
        store.feedback.push(args);
        return { data: true, error: null };
      }
      throw new Error(`Unknown RPC ${name}`);
    },
  }),
}));
import { POST } from "../app/api/room/route";
import { POST as postBetaEvent } from "../app/api/beta/route";
import { POST as postFeedback } from "../app/api/feedback/route";
let sequence = 0;
async function request(uid: string, body: Record<string, unknown>) {
  const response = await POST(new NextRequest("http://localhost/api/room", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${uid}` }, body: JSON.stringify({ actionId: `party-test-${++sequence}`, ...body }) }));
  return { status: response.status, data: await response.json() };
}
async function create() { return (await request("c", { op: "create", name: "Host" })).data as Snapshot; }

beforeEach(() => { vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret-key"); store.rooms.clear(); store.conflicts = 0; store.betaEvents.length = 0; store.feedback.length = 0; });

describe("authenticated party room API", () => {
  it("rejects invalid anonymous identities", async () => {
    expect((await request("invalid", { op: "create", name: "Pretender" })).status).toBe(401);
  });

  it("supports room joins, the eight-player limit, and rejects player nine", async () => {
    const room = await create();
    for (let index = 0; index < 7; index++) expect((await request(`u${index}`, { op: "join", code: room.code, name: `Guest ${index}` })).status).toBe(200);
    expect(store.rooms.get(room.code)?.players).toHaveLength(8);
    expect((await request("x", { op: "join", code: room.code, name: "Player nine" })).data).toMatchObject({ error: "Room is full" });
  });

  it("rejects a join into a missing room and an action from a non-member", async () => {
    expect((await request("x", { op: "join", code: "ABC234", name: "Guest" })).data).toMatchObject({ error: "Room not found" });
    const room = await create();
    expect((await request("x", { op: "action", code: room.code, action: { type: "sync" } })).status).toBe(410);
  });

  it("requires two players, enforces host start, hides submissions, then reveals and scores", async () => {
    const room = await create();
    expect((await request("c", { op: "action", code: room.code, action: { type: "start" } })).data).toMatchObject({ error: "At least two players are required to start" });
    await request("p", { op: "join", code: room.code, name: "Friend" });
    expect((await request("p", { op: "action", code: room.code, action: { type: "start" } })).data).toMatchObject({ error: "Only the host can start the party" });
    await request("c", { op: "action", code: room.code, action: { type: "start" } });
    await request("c", { op: "action", code: room.code, action: { type: "begin-game" } });
    const current = store.rooms.get(room.code)!;
    const gameId = current.session!.round!.minigameId;
    const definition = MINIGAMES[gameId];
    const pick = (playerId: string) => current.session!.round!.config.options.find((option) => definition.validate(option.id, { players: current.players, playerId, config: current.session!.round!.config }))!.id;
    const hostChoice = pick("c");
    const guestChoice = pick("p");
    await request("c", { op: "action", code: room.code, action: { type: "submit", value: hostChoice } });
    const hidden = await request("p", { op: "action", code: room.code, action: { type: "sync", value: false } });
    expect(hidden.data.session.round.myChoice).toBeNull();
    expect(hidden.data.session.round).not.toHaveProperty("submissions");
    await request("p", { op: "action", code: room.code, action: { type: "submit", value: guestChoice } });
    const saved = store.rooms.get(room.code)!;
    expect(saved.session?.phase).toBe("game-results");
    expect(saved.session?.round?.result?.points).toEqual(expect.objectContaining({ c: expect.any(Number), p: expect.any(Number) }));
    await request("c", { op: "action", code: room.code, action: { type: "open-rule-selection" } });
    const selectedRule = store.rooms.get(room.code)!.session!.offeredRules[0].id;
    await request("c", { op: "action", code: room.code, action: { type: "select-rule", value: selectedRule } });
    expect(store.rooms.get(room.code)?.session?.activeRules[0]?.id).toBe(selectedRule);
    expect((await request("p", { op: "action", code: room.code, action: { type: "sync" } })).data.session.round.result.choices).toEqual({ c: hostChoice, p: guestChoice });
  });

  it("persists deadline transitions discovered during a reconnect sync", async () => {
    const host = await create();
    await request("p", { op: "join", code: host.code, name: "Friend" });
    await request("c", { op: "action", code: host.code, action: { type: "start" } });
    const room = store.rooms.get(host.code)!;
    room.session!.gameSlots[0] = "cross-my-heart";
    room.session!.gameConfig = MINIGAMES["cross-my-heart"].config({ players: room.players, gameNumber: 1 });
    store.rooms.set(host.code, room);
    await request("c", { op: "action", code: host.code, action: { type: "begin-game" } });
    const active = store.rooms.get(host.code)!;
    active.session!.round!.deadlineAt = Date.now() - 1;
    const oldRevision = active.revision;
    store.rooms.set(host.code, active);
    const between = await request("p", { op: "action", code: host.code, action: { type: "sync", value: false } });
    expect(between.status).toBe(200);
    expect(between.data.session.round.beat.index).toBe(1);
    expect(store.rooms.get(host.code)!.revision).toBe(oldRevision + 1);
    expect(store.rooms.get(host.code)!.session!.round!.beat!.firstChoices).toEqual({});

    const secondBeat = store.rooms.get(host.code)!;
    secondBeat.session!.round!.deadlineAt = Date.now() - 1;
    store.rooms.set(host.code, secondBeat);
    const result = await request("p", { op: "action", code: host.code, action: { type: "sync", value: false } });
    expect(result.data.session.phase).toBe("game-results");
    expect(store.rooms.get(host.code)!.session!.history).toHaveLength(1);
  });

  it("preserves identity on reconnect and keeps separate rooms private", async () => {
    const first = await create();
    await request("p", { op: "join", code: first.code, name: "Friend" });
    const rejoined = await request("p", { op: "join", code: first.code, name: "Friend" });
    expect(rejoined.data.players.filter((player: { id: string }) => player.id === "p")).toHaveLength(1);
    const second = await request("x", { op: "create", name: "Other host" });
    expect(first.id).not.toBe(second.data.id);
    expect((await request("x", { op: "action", code: first.code, action: { type: "sync" } })).status).toBe(410);
  });

  it("keeps objectives, power use, and balances role-filtered through API refreshes", async () => {
    const host = await create();
    await request("p", { op: "join", code: host.code, name: "Friend" });
    await request("c", { op: "action", code: host.code, action: { type: "start" } });
    await request("c", { op: "action", code: host.code, action: { type: "begin-game" } });
    const initial = await request("c", { op: "action", code: host.code, action: { type: "sync" } });
    expect(initial.data.session.myObjective).toBeTruthy();
    expect(initial.data.session.myChaos).toBe(2);
    expect(initial.data.session).not.toHaveProperty("objectives");
    expect(initial.data.session).not.toHaveProperty("seed");
    expect(initial.data.session.objectiveReveal).toBeUndefined();
    expect(initial.data.session.myPowerOffers).toHaveLength(3);
    const powerId = (initial.data.session.myPowerOffers as string[]).find((id) => !POWERS[id as keyof typeof POWERS].targetRequired)!;
    const spend = { op: "action", code: host.code, action: { type: "use-power", value: powerId }, actionId: "api-power-once" };
    const spent = await request("c", spend);
    expect(spent.data.session.myChaos).toBe(2 - POWERS[powerId as keyof typeof POWERS].cost);
    expect(spent.data.session.myPowers).toHaveLength(1);
    const duplicate = await request("c", { ...spend, action: { type: "use-power", value: powerId } });
    expect(duplicate.data.session.myChaos).toBe(2 - POWERS[powerId as keyof typeof POWERS].cost);
    expect(duplicate.data.session.myPowers[0].id).toBe(powerId);
    const guest = await request("p", { op: "action", code: host.code, action: { type: "sync" } });
    expect(guest.data.session.myChaos).toBe(2);
    expect(guest.data.session.myPowers).toEqual([]);
    expect(JSON.stringify(guest.data.session)).not.toContain("api-power-once");
    expect(guest.data.session.myObjective).toBeTruthy();
    expect(guest.data.session.objectiveReveal).toBeUndefined();
  });
});

describe("public beta event and feedback APIs", () => {
  it("keeps every objective server-only until each player explicitly reveals it", async () => {
    const snapshot = await create();
    await request("p", { op: "join", code: snapshot.code, name: "Friend" });
    const room = store.rooms.get(snapshot.code)!;
    const gameId = Object.keys(MINIGAMES)[0];
    const objective = (id: string) => ({ id, title: `${id} secret goal`, description: `${id} objective text`, progress: 0, target: 1, completed: false, reward: 1 });
    room.session = {
      phase: "final-results", gameNumber: 1, gameSlots: [gameId], seed: "private-seed",
      objectives: { c: objective("c-goal"), p: objective("p-goal") }, objectivesRevealedBy: [],
      chaos: { c: 2, p: 2 }, activePowers: [], round: null,
    } as unknown as Room["session"];
    store.rooms.set(snapshot.code, room);

    const before = await request("c", { op: "action", code: snapshot.code, action: { type: "sync" } });
    expect(before.data.session.objectiveReveal).toBeUndefined();
    expect(JSON.stringify(before.data.session)).not.toContain("objectivesRevealedBy");
    expect(JSON.stringify(before.data.session)).not.toContain("p objective text");

    const reveal = await request("c", { op: "action", code: snapshot.code, action: { type: "reveal-objectives" } });
    expect(reveal.data.session.objectiveReveal.c).toMatchObject({ title: "c-goal secret goal" });
    const guestSync = await request("p", { op: "action", code: snapshot.code, action: { type: "sync" } });
    expect(guestSync.data.session.objectiveReveal).toBeUndefined();
    expect(store.betaEvents.at(-1)).toMatchObject({ name: "objective_revealed", room_id: room.id });
  });

  it("records only allowlisted, coarse runtime errors for a member", async () => {
    const room = await create();
    const response = await postBetaEvent(new NextRequest("http://localhost/api/beta", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer c" },
      body: JSON.stringify({ name: "runtime_error", code: room.code, errorCode: "network", message: "private answer" }),
    }));
    expect(response.status).toBe(204);
    expect(store.betaEvents.at(-1)).toMatchObject({ name: "runtime_error", room_id: room.id, error_code: "network" });
    expect(store.betaEvents.at(-1)).not.toHaveProperty("message");
  });

  it("rejects client attempts to write canonical session events", async () => {
    const response = await postBetaEvent(new NextRequest("http://localhost/api/beta", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer c" },
      body: JSON.stringify({ name: "session_completed" }),
    }));
    expect(response.status).toBe(400);
    expect(store.betaEvents).toHaveLength(0);
  });

  it("stores private feedback with a per-session pseudonymous duplicate key", async () => {
    const snapshot = await create();
    const room = store.rooms.get(snapshot.code)!;
    const gameId = Object.keys(MINIGAMES)[0];
    room.session = { phase: "final-results", seed: "server-only-seed", gameSlots: [gameId], objectivesRevealedBy: ["c"] } as Room["session"];
    store.rooms.set(snapshot.code, room);
    const response = await postFeedback(new NextRequest("http://localhost/api/feedback", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer c" },
      body: JSON.stringify({ code: snapshot.code, funRating: 5, playAgain: true, favoriteGame: gameId, leastFavoriteGame: "", confusion: "", comment: "Email friend@example.com or call 555-867-5309." }),
    }));
    expect(response.status).toBe(201);
    expect(store.feedback[0]).toMatchObject({ p_room_id: room.id, p_fun_rating: 5, p_play_again: true, p_favorite_game: gameId });
    expect(store.feedback[0].p_respondent_key).toMatch(/^[0-9a-f]{64}$/);
    expect(store.feedback[0].p_respondent_key).not.toBe("c");
    expect(store.feedback[0].p_comment).toBe("Email [email removed] or call [phone removed].");
    const duplicate = await postFeedback(new NextRequest("http://localhost/api/feedback", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer c" },
      body: JSON.stringify({ code: snapshot.code, funRating: 5, playAgain: true, favoriteGame: gameId, leastFavoriteGame: "", confusion: "", comment: "second try" }),
    }));
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toEqual({ submitted: false });
    expect(store.feedback).toHaveLength(1);
  });
});

