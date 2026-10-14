import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import type { Snapshot } from "../lib/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

test("two friends join, play their first seeded game, and see the shared reveal", async ({ browser }) => {
  test.setTimeout(120000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()));
  let roomCode = "";
  const authUserIds = new Set<string>();
  const latest = new Map<Page, Snapshot>();
  for (const page of [host, guest]) {
    page.on("response", (response) => {
      if (!response.url().endsWith("/api/room") || !response.ok()) return;
      void response.json().then((snapshot: Snapshot) => { latest.set(page, snapshot); authUserIds.add(snapshot.me); }).catch(() => {});
    });
  }
  try {
    await Promise.all([host, guest].map(async (page) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: /Know your friends/ })).toBeVisible();
      await expect(page.locator(".connection")).toHaveText("Connected");
    }));
    await host.getByLabel("Your name").fill("Host QA");
    await host.getByRole("button", { name: "Create a room" }).click();
    await expect(host.getByRole("heading", { name: "The room is yours." })).toBeVisible();
    const code = await host.locator(".room-banner strong").innerText();
    roomCode = code;
    await guest.getByLabel("Your name").fill("Guest QA");
    await guest.getByLabel("Room code").fill(code);
    await guest.getByRole("button", { name: "Join the party" }).click();
    await expect(guest.getByText("Guest QA", { exact: false })).toBeVisible();
    await expect(host.locator(".player-row")).toHaveCount(2);
    for (const page of [host, guest]) {
      const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(size.scroll).toBeLessThanOrEqual(size.width);
    }
    await host.getByRole("button", { name: "Start the party" }).click();
    await expect(host.getByRole("button", { name: "Start game 1" })).toBeVisible();
    const gameId = latest.get(host)!.session!.gameSlots[0];
    const gameName = host.locator(".intro-phase h2");
    await expect(gameName).toBeVisible();
    await host.getByRole("button", { name: "Start game 1" }).click();
    await host.locator(".choice-button:not(:disabled)").first().click();
    await expect(host.getByText(/Your choice is locked/)).toBeVisible();
    await expect(guest.locator(".reveal-list")).toHaveCount(0);
    await guest.locator(".choice-button:not(:disabled)").first().click();
    await expect.poll(() => latest.get(host)?.session?.phase).toBe("game-results");
    await expect(guest.locator(".reveal-row")).toHaveCount(2);
    expect(latest.get(host)?.session?.round?.minigameId).toBe(gameId);
    await expect(host.locator(".reveal-groups")).toBeVisible();
  } finally {
    if (roomCode) {
      await host.getByRole("button", { name: "Leave room" }).click({ timeout: 3000 }).catch(() => {});
      await guest.getByRole("button", { name: "Leave room" }).click({ timeout: 3000 }).catch(() => {});
    }
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (url && key) {
      const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      if (roomCode) await db.from("cr_rooms").delete().eq("code", roomCode);
      for (const userId of authUserIds) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) continue;
        await db.auth.admin.deleteUser(userId);
      }
    }
  }
});
