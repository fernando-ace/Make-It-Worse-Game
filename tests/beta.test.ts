import { describe, expect, it, vi } from "vitest";
import { recordBetaEvents } from "../lib/beta";

describe("best-effort beta telemetry", () => {
  it("returns after a storage timeout without blocking its caller", async () => {
    vi.useFakeTimers();
    try {
      const pending = recordBetaEvents({ rpc: () => new Promise(() => {}) }, [{ name: "session_completed" }], 25);
      await vi.advanceTimersByTimeAsync(26);
      await expect(pending).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });

  it("does not write a telemetry batch when the event list is empty", async () => {
    const rpc = vi.fn();
    await recordBetaEvents({ rpc }, []);
    expect(rpc).not.toHaveBeenCalled();
  });
});
