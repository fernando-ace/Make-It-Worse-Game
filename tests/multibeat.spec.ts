import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import type { Snapshot } from "../lib/types";
import { expectEphemeralSupabase, reconnectByReload } from "./helpers/reconnect";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

test("selected Party Night two-beat game survives refresh and resolves through the real room API", async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY || !process.env.E2E_TEST_GAME_ID, "Requires local Supabase and a server-selected E2E_TEST_GAME_ID.");
  expectEphemeralSupabase();
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map(context => context.newPage()));
  const latest = new Map<Page, Snapshot>();
  let code = "";
  for (const page of [host, guest]) {
    page.on("response", response => {
      if (response.url().endsWith("/api/room") && response.ok()) void response.json().then((snapshot: Snapshot) => latest.set(page, snapshot)).catch(() => {});
    });
  }
  const size = async (page: Page) => page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  try {
    await Promise.all([host, guest].map(async page => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await expect(page.locator(".connection")).toHaveText("Connected");
    }));
    await host.getByLabel("Your name").fill("Host test");
    await host.getByRole("button", { name: "Create a room" }).click();
    await expect(host.getByRole("heading", { name: "The room is yours." })).toBeVisible();
    code = await host.locator(".room-banner strong").innerText();
    await guest.getByLabel("Your name").fill("Guest test");
    await guest.getByLabel("Room code").fill(code);
    await guest.getByRole("button", { name: "Join the party" }).click();
    await expect(host.locator(".player-row")).toHaveCount(2);
    await host.getByRole("button", { name: "Start the party" }).click();
    await expect(host.getByRole("button", { name: "Start game 1" })).toBeVisible();
    await host.getByRole("button", { name: "Start game 1" }).click();
    await expect.poll(() => latest.get(host)?.session?.round?.minigameId).toBe(process.env.E2E_TEST_GAME_ID);
    await expect.poll(() => latest.get(guest)?.session?.round?.minigameId).toBe(process.env.E2E_TEST_GAME_ID);
    await expect(host.getByText("BEAT 1 OF 2")).toBeVisible();
    await expect(host.getByRole("timer")).toHaveAttribute("aria-label", /seconds remaining/);
    const hostId = latest.get(host)!.me;
    const guestId = latest.get(guest)!.me;
    const firstHostChoice = latest.get(host)!.session!.round!.config.options[0].id;
    await host.locator(".choice-button:not(:disabled)").first().click();
    await expect.poll(() => latest.get(host)?.session?.round?.myChoice).toBe(firstHostChoice);
    const afterBeatOneCommit = await reconnectByReload(host, () => latest.get(host));
    expect(afterBeatOneCommit.after.session?.round?.myChoice).toBe(firstHostChoice);
    expect(latest.get(guest)?.session?.round?.myChoice).toBeNull();
    expect(latest.get(guest)?.session?.round?.beat?.publicLines).toEqual([]);
    expect(latest.get(guest)?.session?.round).not.toHaveProperty("submissions");
    await guest.locator(".choice-button:not(:disabled)").nth(1).click();
    await expect.poll(() => latest.get(host)?.session?.round?.beat?.index).toBe(1);
    await expect(host.getByText("BEAT 2 OF 2")).toBeVisible();
    const publicLines = latest.get(guest)!.session!.round!.beat!.publicLines;
    expect(publicLines).toHaveLength(2);
    expect(publicLines.some(line => line.startsWith("Host test:"))).toBe(true);
    if (process.env.E2E_TEST_GAME_ID === "signal-noise") {
      const hostHint = latest.get(host)!.session!.round!.beat!.myHint;
      const guestHint = latest.get(guest)!.session!.round!.beat!.myHint;
      expect(Boolean(hostHint?.includes("True route:")) !== Boolean(guestHint?.includes("True route:"))).toBe(true);
      expect(JSON.stringify(latest.get(host))).not.toContain("privateHints");
      expect(JSON.stringify(latest.get(guest))).not.toContain("privateHints");
    }
    const hostFirstChoice = latest.get(host)!.session!.round!.beat!.myFirstChoice;
    expect(hostFirstChoice).toBe(firstHostChoice);
    const guestFirstChoice = latest.get(guest)!.session!.round!.beat!.myFirstChoice;
    expect(guestFirstChoice).not.toBe(hostFirstChoice);
    const afterBeatTransition = await reconnectByReload(guest, () => latest.get(guest));
    expect(afterBeatTransition.after.session?.round?.beat?.index).toBe(1);
    expect(afterBeatTransition.after.session?.round?.myChoice).toBeNull();
    expect(latest.get(guest)?.session?.round?.beat?.myFirstChoice).toBe(guestFirstChoice);
    const guestSecondChoice = latest.get(guest)!.session!.round!.config.options[1].id;
    await guest.locator(".choice-button:not(:disabled)").nth(1).click();
    await expect.poll(() => latest.get(guest)?.session?.round?.myChoice).toBe(guestSecondChoice);
    const afterSecondBeatCommit = await reconnectByReload(guest, () => latest.get(guest));
    expect(afterSecondBeatCommit.after.session?.round?.beat?.index).toBe(1);
    expect(latest.get(guest)?.me).toBe(guestId);
    expect(latest.get(guest)?.session?.round?.beat?.myFirstChoice).toBe(guestFirstChoice);
    expect(latest.get(guest)?.session?.round?.myChoice).toBe(guestSecondChoice);
    await Promise.all([host, guest].map(async page => expect((await size(page)).scroll).toBeLessThanOrEqual((await size(page)).width)));
    if (latest.get(host)?.session?.phase === "active-game" && !latest.get(host)?.session?.round?.myChoice) {
      await host.locator(".choice-button:not(:disabled)").first().click();
      await expect.poll(() => latest.get(host)?.session?.round?.myChoice).toBeTruthy();
    }
    await expect.poll(() => latest.get(host)?.session?.phase).toBe("game-results");
    const resultReconnect = await reconnectByReload(host, () => latest.get(host));
    expect(resultReconnect.after.session?.phase).toBe("game-results");
    expect(resultReconnect.after.session?.history).toHaveLength(1);
    await expect(host.locator(".reveal-row")).toHaveCount(2);
    expect(latest.get(host)?.session?.history).toHaveLength(1);
    expect(latest.get(host)?.session?.scores).toBeDefined();
    expect(latest.get(host)?.me).toBe(hostId);
    await Promise.all([host, guest].map(async page => {
      await page.setViewportSize({ width: 430, height: 700 });
      expect((await size(page)).scroll).toBeLessThanOrEqual((await size(page)).width);
    }));
  } finally {
    await Promise.all(contexts.map(context => context.close().catch(() => {})));
  }
});
