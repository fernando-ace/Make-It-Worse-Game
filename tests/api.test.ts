import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Room, Snapshot } from "../lib/types";
import { MINIGAMES } from "../lib/games";
import { POWERS } from "../lib/powers";

const store = vi.hoisted(() => ({ rooms: new Map<string, Room>(), conflicts: 0, betaEvents: [] as Record<string, unknown>[], metrics: [] as Record<string, unknown>[], feedback: [] as Record<string, unknown>[], failTelemetry: false, failFeedback: false }));
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
      if (name === "cr_record_beta_events") { if (store.failTelemetry) throw new Error("synthetic telemetry outage"); store.betaEvents.push(...(args.p_events as Record<string, unknown>[])); return { data: (args.p_events as unknown[]).length, error: null }; }
      if (name === "cr_record_party_metric") { store.metrics.push(args.p_metric as Record<string, unknown>); return { data: null, error: null }; }
      if (name === "cr_submit_beta_feedback") {
        if (store.failFeedback) throw new Error("synthetic feedback storage outage");
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
import { GET as getCleanup } from "../app/api/cron/cleanup/route";
let sequence = 0;
async function request(uid: string, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  const response = await POST(new NextRequest("http://localhost/api/room", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${uid}`, ...extraHeaders }, body: JSON.stringify({ actionId: `party-test-${++sequence}`, ...body }) }));
  return { status: response.status, data: await response.json() };
}
async function create() { return (await request("c", { op: "create", name: "Host" })).data as Snapshot; }

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret-key");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("BETA_DEPLOYMENT_CLASS", "test");
  vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_CLASS", "test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://makeitworsetest123456.supabase.co");
  vi.stubEnv("TEST_SUPABASE_PROJECT_REF", "makeitworsetest123456");
  vi.stubEnv("BETA_SUPABASE_PROJECT_REF", "");
  store.rooms.clear(); store.conflicts = 0; store.betaEvents.length = 0; store.metrics.length = 0;
  store.feedback.length = 0; store.failTelemetry = false; store.failFeedback = false;
});

describe("authenticated party room API", () => {
  it("refuses Preview writes when its Supabase URL resolves to Production", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_CLASS", "preview");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://jfosecuafntktpudjhyj.supabase.co");
    vi.stubEnv("BETA_SUPABASE_PROJECT_REF", "makeitworsebeta123456");
    const result = await request("c", { op: "create", name: "Host" });
    expect(result.status).toBe(503);
    expect(store.rooms.size).toBe(0);
  });

  it("blocks beta telemetry, feedback, and maintenance on a Production-backed Preview", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_CLASS", "preview");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://jfosecuafntktpudjhyj.supabase.co");
    vi.stubEnv("BETA_SUPABASE_PROJECT_REF", "makeitworsebeta123456");
    const headers = { "Content-Type": "application/json", Authorization: "Bearer c" };
    const telemetry = await postBetaEvent(new NextRequest("http://localhost/api/beta", { method: "POST", headers, body: JSON.stringify({ name: "landing_viewed" }) }));
    const feedback = await postFeedback(new NextRequest("http://localhost/api/feedback", { method: "POST", headers, body: JSON.stringify({}) }));
    vi.stubEnv("CRON_SECRET", "cron-test");
    const cleanup = await getCleanup(new NextRequest("http://localhost/api/cron/cleanup", { headers: { Authorization: "Bearer cron-test" } }));
    expect(telemetry.status).toBe(503);
    expect(feedback.status).toBe(503);
    expect(cleanup.status).toBe(503);
    expect(store.betaEvents).toHaveLength(0);
    expect(store.feedback).toHaveLength(0);
  });

  it("records only server-derived structured party metrics", async () => {
    const room = await create();
    await request("p", { op: "join", code: room.code, name: "Friend" });
    await request("c", { op: "action", code: room.code, action: { type: "start" } });
    const started = store.rooms.get(room.code)!;
    started.session!.gameSlots[0] = "split-decision";
    started.session!.gameConfig = MINIGAMES["split-decision"].config({ players: started.players, gameNumber: 1 });
    store.rooms.set(room.code, started);
    await request("c", { op: "action", code: room.code, action: { type: "begin-game" } });
    const current = store.rooms.get(room.code)!;
    const definition = MINIGAMES["split-decision"];
    const pick = (id: string) => current.session!.round!.config.options.find((option) => definition.validate(option.id, { players: current.players, playerId: id, config: current.session!.round!.config }))!.id;
    await request("c", { op: "action", code: room.code, action: { type: "submit", value: pick("c") } });
    await request("p", { op: "action", code: room.code, action: { type: "submit", value: pick("p") } });
    expect(store.metrics.length).toBeGreaterThan(0);
    const row = store.metrics.at(-1)!;
    expect(row).toMatchObject({ gameId: "split-decision", playerCount: 2, completed: 1, roomId: expect.any(String) });
    expect(row).not.toHaveProperty("name");
    expect(row).not.toHaveProperty("objectiveText");
    expect(row).not.toHaveProperty("privateHint");
    expect(row).not.toHaveProperty("answer");
  });

  it("keeps a running room playable when beta telemetry storage is unavailable", async () => {
    const room = await create();
    await request("p", { op: "join", code: room.code, name: "Friend" });
    store.failTelemetry = true;
    const started = await request("c", { op: "action", code: room.code, action: { type: "start" } });
    expect(started.status).toBe(200);
    expect(store.rooms.get(room.code)?.session?.phase).toBe("game-intro");
  });

  it("resolves simultaneous submissions once and leaves an active room playable after a player leaves", async () => {
    const room = await create();
    await request("p", { op: "join", code: room.code, name: "Friend" });
    await request("u0", { op: "join", code: room.code, name: "Third" });
    await request("c", { op: "action", code: room.code, action: { type: "start" } });
    const active = store.rooms.get(room.code)!;
    active.session!.gameSlots[0] = "split-decision";
    active.session!.gameConfig = MINIGAMES["split-decision"].config({ players: active.players, gameNumber: 1 });
    store.rooms.set(room.code, active);
    await request("c", { op: "action", code: room.code, action: { type: "begin-game" } });
    await Promise.all([
      request("c", { op: "action", code: room.code, action: { type: "submit", value: "RED" } }),
      request("p", { op: "action", code: room.code, action: { type: "submit", value: "BLUE" } }),
      request("u0", { op: "action", code: room.code, action: { type: "submit", value: "BLUE" } }),
    ]);
    const completed = store.rooms.get(room.code)!;
    expect(completed.session?.history).toHaveLength(1);
    expect(completed.session?.round?.result?.choices).toEqual({ c: "RED", p: "BLUE", u0: "BLUE" });

    // The original two-player case is important: after an explicit leave, the
    // remaining member must not wait for an impossible quorum on the next sync.
    const twoPlayer = await create();
    await request("p", { op: "join", code: twoPlayer.code, name: "Friend" });
    await request("c", { op: "action", code: twoPlayer.code, action: { type: "start" } });
    const running = store.rooms.get(twoPlayer.code)!;
    running.session!.gameSlots[0] = "split-decision";
    running.session!.gameConfig = MINIGAMES["split-decision"].config({ players: running.players, gameNumber: 1 });
    store.rooms.set(twoPlayer.code, running);
    await request("c", { op: "action", code: twoPlayer.code, action: { type: "begin-game" } });
    await request("p", { op: "leave", code: twoPlayer.code });
    const afterLeave = await request("c", { op: "action", code: twoPlayer.code, action: { type: "sync" } });
    expect(afterLeave.status).toBe(200);
    expect(afterLeave.data.session.phase).toBe("active-game");
    expect(afterLeave.data.players).toHaveLength(1);
    await request("c", { op: "action", code: twoPlayer.code, action: { type: "submit", value: "RED" } });
    expect(store.rooms.get(twoPlayer.code)?.session?.phase).toBe("game-results");
    expect(store.rooms.get(twoPlayer.code)?.session?.history).toHaveLength(1);
  });

  it("transfers lobby and active host ownership safely when the host explicitly leaves", async () => {
    const lobby = await create();
    await request("p", { op: "join", code: lobby.code, name: "Friend" });
    await request("u0", { op: "join", code: lobby.code, name: "Third" });
    await request("c", { op: "leave", code: lobby.code });
    expect(store.rooms.get(lobby.code)?.hostId).toBe("p");
    expect(store.rooms.get(lobby.code)?.players.map(player => player.id)).toEqual(["p", "u0"]);
    const lobbyStart = await request("p", { op: "action", code: lobby.code, action: { type: "start" } });
    expect(lobbyStart.status).toBe(200);
    expect(lobbyStart.data.hostId).toBe("p");

    const active = await create();
    await request("p", { op: "join", code: active.code, name: "Friend" });
    await request("c", { op: "action", code: active.code, action: { type: "start" } });
    const running = store.rooms.get(active.code)!;
    running.session!.gameSlots[0] = "split-decision";
    running.session!.gameConfig = MINIGAMES["split-decision"].config({ players: running.players, gameNumber: 1 });
    store.rooms.set(active.code, running);
    await request("c", { op: "action", code: active.code, action: { type: "begin-game" } });
    await request("c", { op: "leave", code: active.code });
    expect(store.rooms.get(active.code)?.hostId).toBe("p");
    const finish = await request("p", { op: "action", code: active.code, action: { type: "submit", value: "RED" } });
    expect(finish.status).toBe(200);
    expect(finish.data.session.phase).toBe("game-results");
  });

  it("replays once when duplicate replay requests race", async () => {
    const room = await create();
    await request("p", { op: "join", code: room.code, name: "Friend" });
    await request("c", { op: "action", code: room.code, action: { type: "start" } });
    const completed = store.rooms.get(room.code)!;
    completed.session!.phase = "final-results";
    const oldSeed = completed.session!.seed;
    store.rooms.set(room.code, completed);
    const replayAction = { actionId: "replay-once", op: "action", code: room.code, action: { type: "restart-session" } };
    const results = await Promise.all([request("c", replayAction), request("c", replayAction)]);
    expect(results.every(result => result.status === 200)).toBe(true);
    const replayed = store.rooms.get(room.code)!;
    expect(replayed.session?.phase).toBe("game-intro");
    expect(replayed.session?.gameNumber).toBe(1);
    expect(replayed.session?.seed).not.toBe(oldSeed);
    expect(store.rooms.size).toBe(1);
  });

  it("does not fail an authoritative action when runtime metric logging throws", async () => {
    const room = await create();
    await request("p", { op: "join", code: room.code, name: "Friend" });
    await request("c", { op: "action", code: room.code, action: { type: "start" } });
    const active = store.rooms.get(room.code)!;
    active.session!.gameSlots[0] = "split-decision";
    active.session!.gameConfig = MINIGAMES["split-decision"].config({ players: active.players, gameNumber: 1 });
    store.rooms.set(room.code, active);
    await request("c", { op: "action", code: room.code, action: { type: "begin-game" } });
    await request("c", { op: "action", code: room.code, action: { type: "submit", value: "RED" } });
    const logging = vi.spyOn(console, "info").mockImplementation(() => { throw new Error("serialization/log sink failed"); });
    try {
      const last = await request("p", { op: "action", code: room.code, action: { type: "submit", value: "BLUE" } });
      expect(last.status).toBe(200);
      expect(last.data.session.phase).toBe("game-results");
    } finally { logging.mockRestore(); }
  });

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
    await Promise.all([0, 1].map(() => request("c", { actionId: "house-rule-once", op: "action", code: room.code, action: { type: "select-rule", value: selectedRule } })));
    expect(store.rooms.get(room.code)?.session?.activeRules[0]?.id).toBe(selectedRule);
    expect(store.rooms.get(room.code)?.session?.activeRules.filter(rule => rule.id === selectedRule)).toHaveLength(1);
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
    const deadlineRevision = store.rooms.get(host.code)!.revision;
    const deadlineSyncs = await Promise.all(Array.from({ length: 5 }, (_, index) => request(index % 2 ? "c" : "p", { op: "action", code: host.code, action: { type: "sync", value: false } })));
    expect(deadlineSyncs.every(result => result.data.session.phase === "game-results")).toBe(true);
    expect(store.rooms.get(host.code)!.session!.history).toHaveLength(1);
    expect(store.rooms.get(host.code)!.revision).toBe(deadlineRevision + 1);
    const resolvedRevision = store.rooms.get(host.code)!.revision;
    const resolvedScores = structuredClone(store.rooms.get(host.code)!.session!.scores);
    const repeated = await Promise.all(Array.from({ length: 5 }, () => request("c", { op: "action", code: host.code, action: { type: "sync" } })));
    expect(repeated.every(response => response.data.session.phase === "game-results")).toBe(true);
    expect(store.rooms.get(host.code)!.session!.history).toHaveLength(1);
    expect(store.rooms.get(host.code)!.session!.scores).toEqual(resolvedScores);
    expect(store.rooms.get(host.code)!.revision).toBe(resolvedRevision + 5);
  });

  it("ignores the deterministic clock header in production even if the E2E flag is set", async () => {
    const host = await create();
    await request("p", { op: "join", code: host.code, name: "Friend" });
    await request("c", { op: "action", code: host.code, action: { type: "start" } });
    await request("c", { op: "action", code: host.code, action: { type: "begin-game" } });
    const active = store.rooms.get(host.code)!;
    active.session!.round!.deadlineAt = Date.now() + 60_000;
    store.rooms.set(host.code, active);
    const priorNodeEnv = process.env.NODE_ENV ?? "test";
    const priorE2e = process.env.E2E_TEST_MODE;
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DEPLOYMENT_CLASS", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://jfosecuafntktpudjhyj.supabase.co");
    vi.stubEnv("E2E_TEST_MODE", "1");
    try {
      const sync = await request("p", { op: "action", code: host.code, action: { type: "sync" } }, { "x-e2e-clock-offset-ms": "300000" });
      expect(sync.status).toBe(200);
      expect(sync.data.session.phase).toBe("active-game");
    } finally {
      vi.stubEnv("NODE_ENV", priorNodeEnv);
      vi.stubEnv("E2E_TEST_MODE", priorE2e ?? "");
      vi.stubEnv("VERCEL_ENV", "");
    }
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
    const [spent, duplicate] = await Promise.all([request("c", spend), request("c", spend)]);
    expect(spent.data.session.myChaos).toBe(2 - POWERS[powerId as keyof typeof POWERS].cost);
    expect(spent.data.session.myPowers).toHaveLength(1);
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

  it("treats client telemetry and feedback outages as non-gameplay failures", async () => {
    const snapshot = await create();
    store.failTelemetry = true;
    const metric = await postBetaEvent(new NextRequest("http://localhost/api/beta", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer c" },
      body: JSON.stringify({ name: "landing_viewed" }),
    }));
    expect(metric.status).toBe(204);
    const launched = await request("c", { op: "action", code: snapshot.code, action: { type: "sync" } });
    expect(launched.status).toBe(200);

    await request("p", { op: "join", code: snapshot.code, name: "Friend" });
    await request("c", { op: "action", code: snapshot.code, action: { type: "start" } });
    const room = store.rooms.get(snapshot.code)!;
    const gameId = room.session!.gameSlots[0];
    room.session!.phase = "final-results";
    room.session!.objectivesRevealedBy = ["c"];
    store.rooms.set(snapshot.code, room);
    store.failFeedback = true;
    const feedback = await postFeedback(new NextRequest("http://localhost/api/feedback", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer c" },
      body: JSON.stringify({ code: snapshot.code, funRating: 4, playAgain: true, favoriteGame: gameId, leastFavoriteGame: "", confusion: "", comment: "" }),
    }));
    expect(feedback.status).toBe(503);
    expect((await request("c", { op: "action", code: snapshot.code, action: { type: "sync" } })).status).toBe(200);
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

