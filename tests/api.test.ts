import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Room, Snapshot } from "../lib/types";

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
    await request("c", { op: "action", code: room.code, action: { type: "begin-round" } });
    await request("c", { op: "action", code: room.code, action: { type: "submit", value: "RED" } });
    const hidden = await request("p", { op: "action", code: room.code, action: { type: "sync", value: false } });
    expect(hidden.data.session.round.myChoice).toBeNull();
    expect(hidden.data.session.round).not.toHaveProperty("submissions");
    await request("p", { op: "action", code: room.code, action: { type: "submit", value: "BLUE" } });
    const saved = store.rooms.get(room.code)!;
    expect(saved.session?.phase).toBe("round-results");
    expect(saved.session?.round?.result?.points).toEqual({ c: 1, p: 1 });
    await request("c", { op: "action", code: room.code, action: { type: "open-rule-selection" } });
    await request("c", { op: "action", code: room.code, action: { type: "select-rule", value: "double-down" } });
    expect(store.rooms.get(room.code)?.session?.activeRules[0]?.id).toBe("double-down");
    expect((await request("p", { op: "action", code: room.code, action: { type: "sync" } })).data.session.round.result.choices).toEqual({ c: "RED", p: "BLUE" });
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
});
