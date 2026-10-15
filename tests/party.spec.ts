import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import type { Snapshot } from "../lib/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

test("two friends complete a full mobile session without horizontal overflow", async ({ browser }) => {
  test.setTimeout(900000);
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
    await host.getByLabel("Chaos intensity").selectOption("high");
    await expect.poll(() => latest.get(guest)?.chaosIntensity).toBe("high");
    for (const page of [host, guest]) {
      const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(size.scroll).toBeLessThanOrEqual(size.width);
    }
    await host.getByRole("button", { name: "Start the party" }).click();
    await expect(host.getByRole("button", { name: "Start game 1" })).toBeVisible();
    const playSession = async () => {
      for (let number = 1; number <= 6; number++) {
        if (number > 1) {
          await host.getByRole("button", { name: "Next game" }).click();
          await expect(host.getByRole("button", { name: `Start game ${number}` })).toBeVisible();
        }
        const gameId = latest.get(host)!.session!.gameSlots[number - 1];
        await host.getByRole("button", { name: `Start game ${number}` }).click();
        await expect.poll(() => [host, guest].every((page) => latest.get(page)?.session?.phase === "active-game" && latest.get(page)?.session?.round?.number === number)).toBe(true);
        if (number === 1) {
          expect(latest.get(host)?.session?.chaosIntensity).toBe("high");
          expect(latest.get(guest)?.session?.myChaos).toBe(3);
        }
        expect(latest.get(host)?.session?.round?.minigameId).toBe(gameId);
        await expect(guest.locator(".reveal-list")).toHaveCount(0);
        const firstId = latest.get(host)!.session!.round!.firstCommitPlayerId;
        const ordered = firstId ? [pagesFor(firstId), ...[host, guest].filter((page) => latest.get(page)?.me !== firstId)] : [host, guest];
        for (const page of ordered) {
          await page.locator(".choice-button:not(:disabled)").first().click();
          await expect.poll(() => Boolean(latest.get(page)?.session?.round?.myChoice)).toBe(true);
        }
        await expect.poll(() => latest.get(host)?.session?.phase).toBe("game-results");
        await expect(host.locator(".reveal-row")).toHaveCount(2);
        if (number < 6) {
          const winner = pagesFor(latest.get(host)!.session!.ruleWinnerId!);
          await winner.getByRole("button", { name: "Choose a House Rule" }).click();
          await expect(winner.locator(".rule-card").first()).toBeVisible();
          await winner.locator(".rule-card").first().click();
          await expect(host.locator(".intermission")).toBeVisible();
        } else {
          await host.getByRole("button", { name: "See final results" }).click();
          await expect(host.getByText("SESSION COMPLETE · 6 GAMES")).toBeVisible();
        }
        for (const page of [host, guest]) {
          const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
          expect(size.scroll).toBeLessThanOrEqual(size.width);
        }
      }
      await expect(host.getByText("SESSION COMPLETE · 6 GAMES")).toBeVisible();
      expect(latest.get(host)?.session?.history).toHaveLength(6);
      expect(latest.get(host)?.session?.objectiveReveal).toBeTruthy();
      await host.getByRole("button", { name: "Reveal secret objectives" }).click();
      await expect(host.locator(".objective-result")).toHaveCount(2);
      await host.getByRole("button", { name: "Reveal party awards" }).click();
    };
    const pagesFor = (playerId: string) => [host, guest].find((page) => latest.get(page)?.me === playerId)!;
    await playSession();
    await expect(host.getByRole("button", { name: "Reveal session records" })).toBeVisible();
    await host.getByRole("button", { name: "Reveal session records" }).click();
    for (const page of [host, guest]) {
      await page.setViewportSize({ width: 430, height: 932 });
      const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      expect(size.width).toBe(430);
      expect(size.scroll).toBeLessThanOrEqual(size.width);
    }
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
