import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { Snapshot } from "../lib/types";
import { reconnectByReload, observeRoomSnapshots } from "./helpers/reconnect";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function localSupabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  expect(value).toBeTruthy();
  expect(["localhost", "127.0.0.1", "::1"]).toContain(new URL(value!).hostname);
  return value!;
}

async function syncRoom(request: APIRequestContext, token: string, code: string) {
  return request.post(`${process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"}/api/room`, {
    headers: { Authorization: `Bearer ${token}`, "x-e2e-clock-offset-ms": "80000" },
    data: { op: "action", code, action: { type: "sync" }, actionId: randomUUID() },
  });
}

test("full-stack server deadlines advance a two-beat game once under concurrent reconnect sync", async ({ browser, request }) => {
  localSupabaseUrl();
  expect(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBeTruthy();
  expect(process.env.SUPABASE_SECRET_KEY).toBeTruthy();
  expect(process.env.E2E_TEST_MODE).toBe("1");
  expect(process.env.E2E_TEST_GAME_ID).toBe("cross-my-heart");

  const contexts: BrowserContext[] = [await browser.newContext(), await browser.newContext()];
  const pages: Page[] = await Promise.all(contexts.map(context => context.newPage()));
  const snapshots = new Map<Page, Snapshot>();
  const userIds = new Set<string>();
  let room: { id: string; code: string } | undefined;
  let clockOffset: number | undefined;
  for (const page of pages) {
    observeRoomSnapshots(page, snapshot => { snapshots.set(page, snapshot); userIds.add(snapshot.me); });
    await page.route("**/api/room", route => {
      const headers = { ...route.request().headers() };
      if (clockOffset !== undefined) headers["x-e2e-clock-offset-ms"] = String(clockOffset);
      return route.continue({ headers });
    });
  }
  const [host, guest] = pages;
  try {
    await Promise.all(pages.map(async page => {
      await page.goto("/");
      await expect(page.locator(".connection")).toHaveText("Connected");
    }));
    await host.getByLabel("Your name").fill("Deadline Host");
    await host.getByRole("button", { name: "Create game" }).click();
    await expect(host.getByRole("heading", { name: "The room is yours." })).toBeVisible();
    const code = await host.locator(".room-banner strong").innerText();
    room = { id: snapshots.get(host)!.id, code };
    await guest.getByLabel("Your name").fill("Deadline Guest");
    await guest.getByLabel("Room code").fill(code);
    await guest.getByRole("button", { name: "Join game" }).click();
    await expect(host.locator(".player-row")).toHaveCount(2);
    await host.getByRole("button", { name: "Start the party" }).click();
    await expect(host.getByRole("button", { name: "Start game 1" })).toBeVisible();
    await host.getByRole("button", { name: "Start game 1" }).click();
    await expect.poll(() => snapshots.get(host)?.session?.round?.minigameId).toBe("cross-my-heart");

    await host.locator(".choice-button:not(:disabled)").first().click();
    await expect.poll(() => snapshots.get(host)?.session?.round?.myChoice).toBeTruthy();
    expect(snapshots.get(guest)?.session?.round?.myChoice).toBeFalsy();
    clockOffset = 32000;
    await expect.poll(() => snapshots.get(host)?.session?.round?.beat?.index, { timeout: 30000 }).toBe(1);
    await expect.poll(() => snapshots.get(guest)?.session?.round?.beat?.index, { timeout: 30000 }).toBe(1);
    expect(snapshots.get(host)?.session?.round?.beat?.myFirstChoice).toBeTruthy();
    expect(snapshots.get(guest)?.session?.round?.beat?.myFirstChoice).toBeFalsy();
    expect(snapshots.get(guest)?.session?.round).not.toHaveProperty("submissions");
    expect(snapshots.get(host)?.session?.round?.beat?.publicLines).toHaveLength(2);

    const beatTwoRefresh = await reconnectByReload(guest, () => snapshots.get(guest));
    expect(beatTwoRefresh.after.session?.round?.beat?.index).toBe(1);
    clockOffset = 80000;
    await expect.poll(() => snapshots.get(host)?.session?.phase, { timeout: 30000 }).toBe("game-results");
    await expect.poll(() => snapshots.get(guest)?.session?.phase, { timeout: 30000 }).toBe("game-results");
    const scores = structuredClone(snapshots.get(host)!.session!.scores);

    const tokens = await Promise.all(pages.map(page => page.evaluate(() => {
      const key = Object.keys(localStorage).find(name => name.startsWith("sb-") && name.endsWith("-auth-token"));
      return key ? JSON.parse(localStorage.getItem(key)!).access_token as string : "";
    })));
    expect(tokens.every(Boolean)).toBe(true);
    const repeated = await Promise.all(tokens.flatMap(token => Array.from({ length: 3 }, () => syncRoom(request, token, code))));
    expect(repeated.every(response => response.status() === 200)).toBe(true);
    expect(snapshots.get(host)?.session?.history).toHaveLength(1);
    expect(snapshots.get(host)?.session?.scores).toEqual(scores);
  } finally {
    await Promise.all(contexts.map(context => context.close().catch(() => {})));
    const key = process.env.SUPABASE_SECRET_KEY;
    if (key) {
      const db = createClient(localSupabaseUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
      if (room) await db.from("cr_rooms").delete().eq("id", room.id).eq("code", room.code);
      for (const userId of userIds) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) continue;
        await db.auth.admin.deleteUser(userId);
      }
    }
  }
});
