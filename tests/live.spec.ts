import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import type { GameOption, Snapshot } from "../lib/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
let contexts: BrowserContext[] = [];
let rooms: Array<{ id: string; code: string }> = [];
let testAuthUserIds = new Set<string>();

test.afterEach(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  const db = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  try {
    if (db) for (const room of rooms) {
      const { error } = await db.from("cr_rooms").delete().eq("id", room.id).eq("code", room.code);
      if (error) throw new Error(`Could not clean up test room: ${error.message}`);
    }
  } finally {
    rooms = [];
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    contexts = [];
    if (db) for (const userId of testAuthUserIds) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) continue;
      const { error } = await db.auth.admin.deleteUser(userId);
      if (error) throw new Error(`Could not clean up test guest: ${error.message}`);
    }
    testAuthUserIds = new Set<string>();
  }
});

test("three players complete the six-game Make It Worse session with privacy, House Rules, reconnect, and awards", async ({ browser }) => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !process.env.SUPABASE_SECRET_KEY, "Requires the configured real Supabase project.");
  test.setTimeout(900000);
  contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  let host = pages[0];
  let guestOne = pages[1];
  let guestTwo = pages[2];
  const latest = new Map<Page, Snapshot>();
  const runtimeErrors: string[] = [];
  testAuthUserIds = new Set<string>();
  for (const page of pages) {
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(60000);
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
    page.on("response", (response) => {
      if (!response.url().endsWith("/api/room")) return;
      if (!response.ok()) {
        void response.json().then((result: { error?: string }) => runtimeErrors.push(`API ${response.status()}: ${result.error ?? "request failed"}`)).catch(() => {});
        return;
      }
      void response.json().then((snapshot: Snapshot) => { latest.set(page, snapshot); testAuthUserIds.add(snapshot.me); }).catch(() => {});
    });
  }
  await Promise.all(pages.map(async (page, index) => {
    await page.setViewportSize({ width: index === 1 ? 390 : 1365, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await expect(page.locator(".connection")).toHaveText("Connected", { timeout: 120000 });
    await expect(page.getByLabel("Your name")).toBeVisible();
    await page.getByLabel("Your name").fill(["Host", "Alex", "Blair"][index]);
  }));
  await expect(host).toHaveTitle(/Make It Worse/);
  await expect(host.getByRole("heading", { name: /Make it worse/ })).toBeVisible();
  await host.getByRole("button", { name: "Create a room" }).click();
  await expect(host.getByRole("heading", { name: "The room is yours." })).toBeVisible();
  const code = await host.locator(".room-banner strong").innerText();
  const originalHostId = latest.get(host)!.me;
  expect(latest.get(host)!.hostId).toBe(originalHostId);
  expect(latest.get(host)!.players.find((player) => player.id === originalHostId)?.name).toBe("Host");
  rooms.push({ id: latest.get(host)!.id, code });
  for (const [page, playerName] of [[guestOne, "Alex"], [guestTwo, "Blair"]] as const) {
    await page.getByLabel("Room code").fill(code);
    await page.getByRole("button", { name: "Join the party" }).click();
    await expect(page.locator(".player-row").filter({ hasText: playerName })).toBeVisible();
  }
  await expect(host.locator(".player-row")).toHaveCount(3);
  const pageForName = (name: string) => pages.find((page) => {
    const snapshot = latest.get(page);
    return snapshot?.players.find((player) => player.id === snapshot.me)?.name === name;
  });
  host = pageForName("Host")!;
  guestOne = pageForName("Alex")!;
  guestTwo = pageForName("Blair")!;
  expect(host).toBeTruthy();
  expect(guestOne).toBeTruthy();
  expect(guestTwo).toBeTruthy();
  expect(latest.get(host)?.me).toBe(originalHostId);
  await expect(host.getByRole("button", { name: "Start the party" })).toBeEnabled();

  async function startRound(number: number) {
    if (number > 1) {
      await expect.poll(() => latest.get(host)?.hostId).toBe(originalHostId);
      await expect.poll(() => latest.get(host)?.me).toBe(originalHostId);
      await host.getByRole("button", { name: "Next game" }).click();
      await expect.poll(() => latest.get(host)?.session?.gameNumber, { timeout: 60000 }).toBe(number);
      await expect(host.getByRole("button", { name: `Start game ${number}` })).toBeVisible();
    }
    const gameName = await host.locator(".intro-phase h2").innerText();
    await host.getByRole("button", { name: `Start game ${number}` }).click();
    await expect(host.locator(".round-meta")).toContainText(gameName);
    for (const page of pages) await expect.poll(() => latest.get(page)?.session?.phase, { timeout: 60000 }).toBe("active-game");
    const snapshot = latest.get(host)!;
    expect(snapshot.session?.round?.minigameId).toBe(snapshot.session?.gameSlots[number - 1]);
    expect(snapshot.session?.round).not.toHaveProperty("submissions");
    return { options: snapshot.session!.round!.config.options, gameId: snapshot.session!.round!.minigameId, gameName };
  }
  async function choose(page: Page, label: string) {
    const round = latest.get(host)?.session?.round;
    const choice = round?.config.options.find((option) => option.label === label)?.id;
    expect(choice).toBeTruthy();
    await page.locator(".choice-button").filter({ hasText: label }).first().click();
    await expect.poll(() => latest.get(page)?.session?.round?.myChoice, { timeout: 60000 }).toBe(choice);
  }
  async function finishRound(rule: string) {
    await expect(host.locator(".reveal-groups")).toBeVisible({ timeout: 60000 });
    await expect(host.locator(".reveal-row")).toHaveCount(3);
    await expect.poll(() => latest.get(host)?.session?.phase, { timeout: 60000 }).toBe("game-results");
    const winnerId = latest.get(host)!.session!.ruleWinnerId!;
    const winnerPage = pages.find((page) => latest.get(page)?.me === winnerId)!;
    await expect(winnerPage.getByRole("button", { name: "Choose a House Rule" })).toBeVisible({ timeout: 60000 });
    await winnerPage.getByRole("button", { name: "Choose a House Rule" }).click();
    await expect.poll(() => winnerPage.locator(".rule-card").count(), { timeout: 60000 }).toBeGreaterThan(0);
    for (const page of pages.filter((candidate) => candidate !== winnerPage)) await expect(page.locator(".rule-card").first()).toBeDisabled();
    const card = winnerPage.locator(".rule-card").filter({ hasText: rule }).first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(host.locator(".intermission")).toBeVisible({ timeout: 60000 });
    await expect(host.locator(".house-rule-panel")).toContainText(rule, { timeout: 60000 });
  }

  await host.getByRole("button", { name: "Start the party" }).click();
  await expect(host.getByRole("button", { name: "Start game 1" })).toBeVisible();
  await expect.poll(() => latest.get(host)?.session).not.toBeNull();
  const selectedGames = latest.get(host)!.session!.gameSlots;
  expect(selectedGames).toHaveLength(6);
  expect(new Set(selectedGames).size).toBe(6);
  const byId = (id: string) => pages.find((page) => latest.get(page)?.me === id)!;
  const labelFor = (gameId: string, playerName: string, options: GameOption[]) => {
    if (gameId === "split-decision") return playerName === "Host" ? "RED" : "BLUE";
    if (gameId === "make-it-worse") return playerName === "Host" ? options[0].label : options[1].label;
    if (gameId === "trust-me") return ({ Host: "POOL IT", Alex: "DOUBLE OR NOTHING", Blair: "SWIPE THE BAG" } as Record<string, string>)[playerName];
    if (gameId === "pile-on") return playerName === "Host" ? "DUCK FOR COVER" : "CALL OUT Host";
    if (gameId === "secret-handshake") return ({ Host: "REACH FOR Blair", Alex: "REACH FOR Host", Blair: "REACH FOR Host" } as Record<string, string>)[playerName];
    if (gameId === "hot-potato") return ({ Host: "PASS TO Alex", Alex: "PASS TO Blair", Blair: "TAKE THE HEAT" } as Record<string, string>)[playerName];
    throw new Error(`Unexpected game ${gameId}`);
  };
  const ruleByRound = ["First on the Record", "Soft Landing", "Double Down", "Bounty", "Underdog", "Double Down"];
  for (let number = 1; number <= 6; number++) {
    const { options, gameId } = await startRound(number);
    if (gameId === "make-it-worse") expect(latest.get(host)?.session?.round?.config.promptId).toBeTruthy();
    if (gameId === "trust-me" || gameId === "pile-on" || gameId === "secret-handshake" || gameId === "hot-potato") {
      expect(options.length).toBeGreaterThanOrEqual(4);
    }
    if (number === 4) {
      const activeIds = latest.get(host)!.session!.activeRules.map((rule) => rule.id);
      expect(activeIds).toEqual(expect.arrayContaining(["first-commit", "safety-net", "double-down"]));
      await expect(host.locator(".active-rule")).toHaveCount(activeIds.length);
    }
    const round = latest.get(host)!.session!.round!;
    const firstPage = round.firstCommitPlayerId ? byId(round.firstCommitPlayerId) : null;
    const orderedPages = firstPage ? [firstPage, ...pages.filter((page) => page !== firstPage)] : pages;
    if (number === 2) {
      expect(round.firstCommitPlayerId).toBeTruthy();
      const waitingPage = pages.find((page) => page !== firstPage)!;
      await expect(waitingPage.locator(".first-commit-note")).toBeVisible();
      await expect(waitingPage.locator(".choice-button").first()).toBeDisabled();
      const commitLabel = labelFor(gameId, latest.get(firstPage!)!.players.find((player) => player.id === round.firstCommitPlayerId)?.name ?? "Host", options);
      await choose(firstPage!, commitLabel);
      const reconnectPage = pages.find((page) => page !== firstPage)!;
      await reconnectPage.reload();
      await expect(reconnectPage.locator(".connection")).toHaveText("Connected");
      await expect(reconnectPage.locator(".active-rule")).toContainText("First on the Record");
      expect(latest.get(reconnectPage)?.session?.round?.myChoice).toBeNull();
      expect(latest.get(reconnectPage)?.session?.round).not.toHaveProperty("submissions");
      for (const page of pages.filter((candidate) => candidate !== firstPage)) await choose(page, labelFor(gameId, latest.get(page)!.players.find((player) => player.id === latest.get(page)!.me)?.name ?? "", options));
    } else {
      for (const page of orderedPages) {
        const playerName = latest.get(page)!.players.find((player) => player.id === latest.get(page)!.me)?.name ?? "";
        await choose(page, labelFor(gameId, playerName, options));
      }
    }
    await expect(host.locator(".reveal-groups")).toBeVisible({ timeout: 60000 });
    await expect(host.locator(".reveal-row")).toHaveCount(3);
    await expect.poll(() => latest.get(host)?.session?.phase).toBe("game-results");
    await finishRound(ruleByRound[number - 1]);
    if (gameId === "make-it-worse") expect(latest.get(host)?.session?.round?.result?.events.some((event) => event.type === "read")).toBe(true);
    if (gameId === "trust-me") expect(latest.get(host)?.session?.round?.result?.events.some((event) => event.type === "betrayal")).toBe(true);
    if (gameId === "secret-handshake") expect(latest.get(host)?.session?.round?.result?.events.some((event) => event.type === "betrayed")).toBe(true);
  }
  await host.getByRole("button", { name: "See final results" }).click();
  await expect(host.getByText("SESSION COMPLETE · 6 GAMES")).toBeVisible();
  await expect(host.getByText("Best Read: Host", { exact: false })).toBeVisible();
  await expect(host.getByText("Worst Ally: Alex", { exact: false })).toBeVisible();
  await expect(host.getByText("Most Targeted: Host", { exact: false })).toBeVisible();
  await expect(host.getByText("Most Betrayed: Host", { exact: false })).toBeVisible();
  await expect(host.locator(".rule-explainer").getByText(/Best Ally:/)).toBeVisible();
  await expect(host.locator(".standing-row").first()).toBeVisible();
  for (const page of pages) {
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  }
  expect(runtimeErrors).toEqual([]);

  await host.getByRole("button", { name: "Leave room" }).click();
  await expect(host.getByLabel("Your name")).toHaveValue("Host");
  await host.getByRole("button", { name: "Create a room" }).click();
  await expect(host.getByRole("heading", { name: "The room is yours." })).toBeVisible();
  const retry = latest.get(host)!;
  rooms.push({ id: retry.id, code: retry.code });
  expect(retry.code).not.toBe(code);
  expect(retry.session).toBeNull();
});
