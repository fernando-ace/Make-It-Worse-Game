import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import type { Snapshot } from "../lib/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
let contexts: BrowserContext[] = [];
let room: { id: string; code: string } | null = null;
let testAuthUserIds = new Set<string>();

test.afterEach(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  try {
    if (room && db) {
      const { error } = await db.from("cr_rooms").delete().eq("id", room.id).eq("code", room.code);
      if (error) throw new Error(`Could not clean up test room: ${error.message}`);
    }
  } finally {
    room = null;
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    contexts = [];
    if (db) {
      for (const userId of testAuthUserIds) {
        const { error } = await db.auth.admin.deleteUser(userId);
        if (error) throw new Error(`Could not clean up test guest: ${error.message}`);
      }
    }
    testAuthUserIds = new Set<string>();
  }
});

test("real multiplayer Split Decision reveals choices, applies House Rules, and updates standings", async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY, "Requires the configured real Supabase project.");
  test.setTimeout(180000);
  contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const [host, guestOne, guestTwo] = pages;
  const latest = new Map<Page, Snapshot>();
  testAuthUserIds = new Set<string>();
  for (const page of pages) {
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(60000);
    page.on("response", (response) => {
      if (!response.url().endsWith("/api/room") || !response.ok()) return;
      void response.json().then((snapshot: Snapshot) => { latest.set(page, snapshot); testAuthUserIds.add(snapshot.me); }).catch(() => {});
    });
  }
  await Promise.all(pages.map(async (page, index) => {
    await page.setViewportSize({ width: index === 1 ? 390 : 1365, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await expect(page.locator(".connection")).toHaveText("Connected");
    await expect(page.getByLabel("Your name")).toBeVisible();
    await page.getByLabel("Your name").fill(["Host", "Alex", "Blair"][index]);
  }));
  await host.getByRole("button", { name: "Create a room" }).click();
  await expect(host.getByRole("heading", { name: "The room is yours." })).toBeVisible();
  const code = await host.locator(".room-banner strong").innerText();
  room = { id: latest.get(host)!.id, code };
  for (const [page, playerName] of [[guestOne, "Alex"], [guestTwo, "Blair"]] as const) {
    await page.getByLabel("Room code").fill(code);
    await page.getByRole("button", { name: "Join the party" }).click();
    await expect(page.locator(".player-row").filter({ hasText: playerName })).toBeVisible();
  }
  await expect(host.locator(".player-row")).toHaveCount(3);
  await host.getByRole("button", { name: "Start the party" }).click();
  await host.getByRole("button", { name: "Start round 1" }).click();
  await host.getByRole("button", { name: /RED/ }).click();
  await expect.poll(() => latest.get(guestOne)?.session?.round?.myChoice).toBeNull();
  expect(latest.get(guestOne)?.session?.round).not.toHaveProperty("submissions");
  await guestOne.getByRole("button", { name: /BLUE/ }).click();
  await guestTwo.getByRole("button", { name: /BLUE/ }).click();
  await expect(host.getByRole("heading", { name: "RED was the minority." })).toBeVisible();
  await expect(host.locator(".reveal-row")).toHaveCount(3);
  await expect(guestOne.locator(".reveal-row").filter({ hasText: "Host" })).toContainText("+2");
  await host.getByRole("button", { name: "Choose a House Rule" }).click();
  await expect(guestOne.locator(".rule-card")).toHaveCount(3);
  await expect(guestOne.getByRole("button", { name: /Double Down/ })).toBeDisabled();
  await expect(guestOne.locator(".rule-card").filter({ hasText: "Bounty" })).toContainText("Bounty target:");
  await host.getByRole("button", { name: /Double Down/ }).click();
  await expect(guestTwo.locator(".house-rule-panel")).toContainText("Double Down");
  await host.getByRole("button", { name: "Start round 2" }).click();
  await expect(guestOne.locator(".active-rule")).toContainText("Double Down");
  await host.getByRole("button", { name: /RED/ }).click();
  await guestOne.getByRole("button", { name: /BLUE/ }).click();
  await guestTwo.getByRole("button", { name: /BLUE/ }).click();
  await expect(host.getByText("Party complete", { exact: true })).toBeVisible();
  await expect(host.locator(".reveal-row").filter({ hasText: "Host" })).toContainText("+4");
  await expect(host.locator(".reveal-row").filter({ hasText: "Host" })).toContainText("doubled to 4");
  await expect(host.locator(".standing-row").first()).toContainText("Host");
  for (const page of pages) {
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  }
});
