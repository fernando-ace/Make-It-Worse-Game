import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import type { Snapshot } from "../lib/types";
import { expectEphemeralSupabase } from "./helpers/reconnect";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

test("eight-player targeted game remains usable on short mobile viewports with long names", async ({ browser }) => {
  expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeTruthy();
  expectEphemeralSupabase();
  expect(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBeTruthy();
  expect(process.env.SUPABASE_SECRET_KEY).toBeTruthy();
  expect(process.env.E2E_TEST_MODE).toBe("1");
  expect(process.env.E2E_TEST_GAME_ID).toBe("secret-handshake");

  const contexts: BrowserContext[] = await Promise.all(Array.from({ length: 8 }, () => browser.newContext()));
  const pages: Page[] = await Promise.all(contexts.map(context => context.newPage()));
  const snapshots = new Map<Page, Snapshot>();
  const userIds = new Set<string>();
  let room: { id: string; code: string } | undefined;
  for (const page of pages) page.on("response", response => {
    if (response.url().endsWith("/api/room") && response.ok()) void response.json().then((snapshot: Snapshot) => { snapshots.set(page, snapshot); userIds.add(snapshot.me); }).catch(() => {});
  });
  const [host, ...guests] = pages;
  try {
    await Promise.all(pages.map(async page => {
      await page.setViewportSize({ width: 390, height: 640 });
      await page.goto("/");
      await expect(page.locator(".connection")).toHaveText("Connected");
    }));
    await host.getByLabel("Your name").fill("Player 1 With Long Name");
    await host.getByRole("button", { name: "Create game" }).click();
    await expect(host.getByRole("heading", { name: "The room is yours." })).toBeVisible();
    const code = await host.locator(".room-banner strong").innerText();
    room = { id: snapshots.get(host)!.id, code };
    for (const [index, guest] of guests.entries()) {
      await guest.getByLabel("Your name").fill(`Player ${index + 2} With Long Name`);
      await guest.getByLabel("Room code").fill(code);
      await guest.getByRole("button", { name: "Join game" }).click();
    }
    await expect(host.locator(".player-row")).toHaveCount(8);
    await host.getByRole("button", { name: "Start the party" }).click();
    await expect(host.getByRole("button", { name: "Start game 1" })).toBeVisible();
    await host.getByRole("button", { name: "Start game 1" }).click();
    await expect.poll(() => snapshots.get(host)?.session?.round?.minigameId).toBe("secret-handshake");
    expect(snapshots.get(host)?.players).toHaveLength(8);
    expect(snapshots.get(host)?.session?.round?.config.options).toHaveLength(9);

    for (const page of pages) {
      const metrics = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(metrics.scroll).toBeLessThanOrEqual(metrics.width);
      const firstTarget = page.locator(".choice-button:not(:disabled)").first();
      await firstTarget.scrollIntoViewIfNeeded();
      const rect = await firstTarget.boundingBox();
      expect(rect).toBeTruthy();
      expect(rect!.height).toBeGreaterThanOrEqual(40);
    }

    await Promise.all(pages.map(async page => {
      await page.locator(".choice-button:not(:disabled)").first().click();
      await expect.poll(() => snapshots.get(page)?.session?.round?.myChoice).toBeTruthy();
    }));
    await expect.poll(() => snapshots.get(host)?.session?.phase).toBe("game-results");
    const winnerId = snapshots.get(host)!.session!.ruleWinnerId!;
    const winner = pages.find(page => snapshots.get(page)?.me === winnerId)!;
    await winner.setViewportSize({ width: 390, height: 640 });
    await winner.getByRole("button", { name: "Choose a House Rule" }).click();
    await expect(winner.locator(".rule-card").first()).toBeVisible();
    const ruleBounds = await winner.locator(".rule-card").first().boundingBox();
    expect(ruleBounds).toBeTruthy();
    expect(ruleBounds!.width).toBeLessThanOrEqual(390);
    await winner.locator(".rule-card").first().click();
    await expect(winner.locator(".intermission")).toBeVisible();
    const finalSize = await winner.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(finalSize.scroll).toBeLessThanOrEqual(finalSize.width);
  } finally {
    await Promise.all(contexts.map(context => context.close().catch(() => {})));
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (url && key) {
      const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      if (room) await db.from("cr_rooms").delete().eq("id", room.id).eq("code", room.code);
      for (const userId of userIds) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) continue;
        await db.auth.admin.deleteUser(userId);
      }
    }
  }
});
