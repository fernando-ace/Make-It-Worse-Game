import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { Snapshot } from "../../lib/types";

export function observeRoomSnapshots(page: Page, onSnapshot: (snapshot: Snapshot) => void) {
  const listener = (response: import("@playwright/test").Response) => {
    if (!response.url().endsWith("/api/room") || !response.ok()) return;
    void response.json().then((value: Snapshot) => onSnapshot(value)).catch(() => {});
  };
  page.on("response", listener);
  return () => page.off("response", listener);
}

export function expectEphemeralSupabase(url = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  expect(url).toBeTruthy();
  expect(["localhost", "127.0.0.1", "::1"]).toContain(new URL(url!).hostname);
}

export async function reconnectByReload(page: Page, readSnapshot: () => Snapshot | undefined) {
  const before = readSnapshot();
  if (!before) throw new Error("Cannot reconnect before a room snapshot is observed");
  await page.reload();
  await expect(page.locator(".connection")).toHaveText("Connected");
  await expect.poll(() => readSnapshot()?.me).toBe(before.me);
  await expect.poll(() => readSnapshot()?.id).toBe(before.id);
  await expect.poll(() => readSnapshot()?.revision ?? 0).toBeGreaterThan(before.revision);
  const after = readSnapshot()!;
  expect(after.players.map(player => player.id)).toEqual(before.players.map(player => player.id));
  expect(after.hostId).toBe(before.hostId);
  const sameCheckpoint = after.session?.phase === before.session?.phase
    && after.session?.gameNumber === before.session?.gameNumber
    && after.session?.round?.minigameId === before.session?.round?.minigameId
    && after.session?.round?.beat?.index === before.session?.round?.beat?.index;
  // The server can finish a beat, resolve a rule, or advance the phase while
  // the page reloads. Assert the caller's private snapshot only at the same
  // authoritative checkpoint; the returned snapshot remains the source of truth.
  if (sameCheckpoint) {
    expect(after.session?.round?.deadlineAt).toBe(before.session?.round?.deadlineAt);
    expect(after.session?.round?.myChoice).toBe(before.session?.round?.myChoice);
    expect(after.session?.round?.beat?.myFirstChoice).toBe(before.session?.round?.beat?.myFirstChoice);
    expect(after.session?.round?.beat?.myHint).toBe(before.session?.round?.beat?.myHint);
    expect(after.session?.myObjective).toEqual(before.session?.myObjective);
    expect(after.session?.myChaos).toBe(before.session?.myChaos);
    expect(after.session?.myPowers).toEqual(before.session?.myPowers);
    expect(after.session?.myPowerOffers).toEqual(before.session?.myPowerOffers);
    expect(after.session?.myIntel).toEqual(before.session?.myIntel);
    expect(after.session?.objectiveReveal).toEqual(before.session?.objectiveReveal);
    expect(after.session?.activeRules).toEqual(before.session?.activeRules);
    expect(after.session?.scores).toEqual(before.session?.scores);
  }
  if (after.session) {
    expect(after.session).not.toHaveProperty("seed");
    expect(after.session).not.toHaveProperty("objectives");
    if (after.session.round) expect(after.session.round).not.toHaveProperty("submissions");
  }
  return { before, after };
}

export async function interruptAndReconnect(context: BrowserContext, page: Page, readSnapshot: () => Snapshot | undefined) {
  const before = readSnapshot();
  if (!before) throw new Error("Cannot interrupt before a room snapshot is observed");
  await context.setOffline(true);
  await expect(page.locator(".connection")).toHaveText("Reconnecting", { timeout: 10000 });
  await context.setOffline(false);
  await expect(page.locator(".connection")).toHaveText("Connected", { timeout: 30000 });
  await expect.poll(() => readSnapshot()?.me).toBe(before.me);
  await expect.poll(() => readSnapshot()?.revision ?? 0, { timeout: 30000 }).toBeGreaterThan(before.revision);
  const after = readSnapshot()!;
  // The server may advance while a client is reconnecting. Preserve private
  // state when the phase is unchanged; callers assert any expected transition.
  if (before.session?.phase === after.session?.phase && before.session?.gameNumber === after.session?.gameNumber) {
    expect(after.session?.round?.deadlineAt).toBe(before.session?.round?.deadlineAt);
    expect(after.session?.round?.myChoice).toBe(before.session?.round?.myChoice);
    expect(after.session?.myObjective).toEqual(before.session?.myObjective);
    expect(after.session?.myChaos).toBe(before.session?.myChaos);
    expect(after.session?.myPowers).toEqual(before.session?.myPowers);
  }
  return { before, after };
}

export async function recreateContextWithIdentity(browser: Browser, page: Page, onSnapshot?: (page: Page, snapshot: Snapshot) => void) {
  const state = await page.context().storageState();
  const url = page.url();
  await page.context().close();
  const context = await browser.newContext({ storageState: state });
  const replacement = await context.newPage();
  if (onSnapshot) observeRoomSnapshots(replacement, snapshot => onSnapshot(replacement, snapshot));
  await replacement.goto(url);
  await expect(replacement.locator(".connection")).toHaveText("Connected");
  return { context, page: replacement };
}
