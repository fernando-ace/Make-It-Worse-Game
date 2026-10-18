import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import type { Snapshot } from "../lib/types";
import { expectEphemeralSupabase } from "./helpers/reconnect";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

test("two friends complete a full mobile session without horizontal overflow", async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY, "Requires ephemeral local Supabase.");
  expectEphemeralSupabase();
  test.setTimeout(900000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map((context) => context.newPage()));
  let roomCode = "";
  const authUserIds = new Set<string>();
  const latest = new Map<Page, Snapshot>();
  for (const page of [host, guest]) {
    page.on("response", async (response) => {
      if (response.url().endsWith("/api/room") && response.status() >= 400) {
        console.error(`room API ${response.status()}: ${await response.text()}`);
      }
    });
    page.on("response", (response) => {
      if (!response.url().endsWith("/api/room") || !response.ok()) return;
      void response.json().then((snapshot: Snapshot) => { latest.set(page, snapshot); authUserIds.add(snapshot.me); }).catch(() => {});
    });
  }
  try {
    await Promise.all([host, guest].map(async (page) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.getByRole("heading", { name: /Get the group together/i })).toBeVisible();
      await expect(page.locator(".connection")).toHaveText("Connected");
      expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    }));
    const playerName = host.getByLabel("Your name");
    await playerName.focus();
    await expect(playerName).toHaveCSS("outline-width", "3px");
    await host.keyboard.press("Tab");
    await expect(host.getByLabel("Room code")).toBeFocused();
    await host.getByLabel("Your name").fill("Host With A Very Long");
    await host.getByRole("button", { name: "Create game" }).click();
    await expect(host.getByRole("heading", { name: "The room is yours." })).toBeVisible();
    const code = await host.locator(".room-banner strong").innerText();
    roomCode = code;
    await guest.getByLabel("Your name").fill("Guest With A Very Long");
    await guest.getByLabel("Room code").fill(code);
    await guest.getByRole("button", { name: "Join game" }).click();
    await expect(guest.getByText("Guest With A Very Long", { exact: false })).toBeVisible();
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
          for (const [width, height] of [[390, 640], [390, 844], [430, 720], [844, 390], [768, 1024], [1024, 768], [1440, 900]]) {
            await host.setViewportSize({ width, height });
            const layout = await host.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
            expect(layout.scroll).toBeLessThanOrEqual(layout.width);
            const choice = host.locator(".decision-phase .choice-button:not(:disabled), .decision-phase .player-chip:not(:disabled)").first();
            await choice.scrollIntoViewIfNeeded();
            const bounds = await choice.boundingBox();
            expect(bounds).toBeTruthy();
            expect(bounds!.height).toBeGreaterThanOrEqual(40);
          }
          await host.setViewportSize({ width: 390, height: 844 });
        }
        if (number === 1) {
          expect(latest.get(host)?.session?.chaosIntensity).toBe("high");
          expect(latest.get(guest)?.session?.myChaos).toBe(3);
        }
        expect(latest.get(host)?.session?.round?.minigameId).toBe(gameId);
        await expect(guest.locator(".reveal-list")).toHaveCount(0);
        const hasSecondBeat = Boolean(latest.get(host)?.session?.round?.beat);
        const firstId = latest.get(host)!.session!.round!.firstCommitPlayerId;
        const ordered = firstId ? [pagesFor(firstId), ...[host, guest].filter((page) => latest.get(page)?.me !== firstId)] : [host, guest];
        for (let beat = 0; beat < 2; beat++) {
          if (beat === 1 && !hasSecondBeat) break;
          for (const page of ordered) {
            const choice = page.locator(".decision-phase .choice-button:not(:disabled), .decision-phase .player-chip:not(:disabled)").first();
            await choice.click();
            if (beat === 0 && hasSecondBeat) {
              await expect.poll(() => latest.get(page)?.session?.round?.beat?.index === 1 || Boolean(latest.get(page)?.session?.round?.myChoice)).toBe(true);
            } else await expect.poll(() => Boolean(latest.get(page)?.session?.round?.myChoice) || latest.get(page)?.session?.phase === "game-results").toBe(true);
          }
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
      expect(latest.get(host)?.session?.objectiveReveal).toBeUndefined();
      await host.getByRole("button", { name: "Reveal secret objectives" }).click();
      await expect(host.locator(".objective-result")).toHaveCount(2);
      expect(latest.get(host)?.session?.objectiveReveal).toBeTruthy();
      await host.getByRole("button", { name: "Reveal party awards" }).click();
    };
    const pagesFor = (playerId: string) => [host, guest].find((page) => latest.get(page)?.me === playerId)!;
    await playSession();
    await expect(host.getByRole("button", { name: "Reveal session records" })).toBeVisible();
    await host.getByRole("button", { name: "Reveal session records" }).click();
    await host.setViewportSize({ width: 390, height: 844 });
    await host.getByRole("button", { name: "Give feedback" }).click();
    await expect(host.getByText("How fun was the session?")).toBeVisible();
    await host.reload();
    await expect(host.locator(".connection")).toHaveText("Connected");
    await expect(host.getByRole("button", { name: "Give feedback" })).toBeVisible();
    await host.getByRole("button", { name: "Give feedback" }).click();
    await expect(host.getByText("How fun was the session?")).toBeVisible();
    for (const page of [host, guest]) {
      for (const [width, height] of [[390, 640], [390, 932], [430, 720], [430, 932], [768, 1024], [820, 1180], [1024, 768], [1440, 900]]) {
        await page.setViewportSize({ width, height });
        const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
        expect(size.width).toBe(width);
        expect(size.scroll).toBeLessThanOrEqual(size.width);
      }
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
