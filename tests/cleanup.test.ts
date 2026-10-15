import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../lib/server", () => ({ admin: () => ({ rpc }) }));
import { GET } from "../app/api/cron/cleanup/route";

describe("scheduled beta cleanup", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret");
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { rooms: 2, events: 4, feedback: 1 }, error: null });
  });

  it("rejects requests that do not present the Vercel cron secret", async () => {
    const response = await GET(new NextRequest("http://localhost/api/cron/cleanup"));
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("runs the database cleanup only for an authorized cron request", async () => {
    const response = await GET(new NextRequest("http://localhost/api/cron/cleanup", {
      headers: { Authorization: "Bearer cron-test-secret" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, rooms: 2, events: 4, feedback: 1 });
    expect(rpc).toHaveBeenCalledWith("cr_cleanup_expired_data");
  });
});
