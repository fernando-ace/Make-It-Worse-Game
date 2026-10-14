import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Room, Snapshot } from "../lib/types";
import { MINIGAMES } from "../lib/games";

const store = vi.hoisted(() => ({ rooms: new Map<string, Room>(), conflicts: 0 }));
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
      throw new Error(`Unknown RPC ${name}`);
    },
  }),
}));
import { POST } from "../app/api/room/route";
let sequence = 0;
async function request(uid: string, body: Record<string, unknown>) {
  const response = await POST(new NextRequest("http://localhost/api/room", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${uid}` }, body: JSON.stringify({ actionId: `party-test-${++sequence}`, ...body }) }));
  return { status: response.status, data: await response.json() };
}
async function create() { return (await request("c", { op: "create", name: "Host" })).data as Snapshot; }

beforeEach(() => { store.rooms.clear(); store.conflicts = 0; });

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
    await request("c", { op: "action", code: room.code, action: { type: "select-rule", value: "double-down" } });
    expect(store.rooms.get(room.code)?.session?.activeRules[0]?.id).toBe("double-down");
    expect((await request("p", { op: "action", code: room.code, action: { type: "sync" } })).data.session.round.result.choices).toEqual({ c: hostChoice, p: guestChoice });
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
    const spend = { op: "action", code: host.code, action: { type: "use-power", value: "guard" }, actionId: "api-power-once" };
    const spent = await request("c", spend);
    expect(spent.data.session.myChaos).toBe(0);
    expect(spent.data.session.myPowers).toHaveLength(1);
    const duplicate = await request("c", { ...spend, action: { type: "use-power", value: "amplify" } });
    expect(duplicate.data.session.myChaos).toBe(0);
    expect(duplicate.data.session.myPowers[0].id).toBe("guard");
    const guest = await request("p", { op: "action", code: host.code, action: { type: "sync" } });
    expect(guest.data.session.myChaos).toBe(2);
    expect(guest.data.session.myPowers).toEqual([]);
    expect(JSON.stringify(guest.data.session)).not.toContain("api-power-once");
    expect(guest.data.session.myObjective).toBeTruthy();
    expect(guest.data.session.objectiveReveal).toBeUndefined();
  });
});

