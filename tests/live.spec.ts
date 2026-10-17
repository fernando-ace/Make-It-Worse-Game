import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import type { GameOption, Snapshot } from "../lib/types";
import { MINIGAMES } from "../lib/games";
import { POWERS } from "../lib/powers";

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
    await expect.poll(() => pages.every((page) => latest.get(page)?.session?.phase === "active-game" && latest.get(page)?.session?.round?.number === number), { timeout: 60000 }).toBe(true);
    const snapshot = latest.get(host)!;
    expect(snapshot.session?.round?.minigameId).toBe(snapshot.session?.gameSlots[number - 1]);
    expect(snapshot.session?.round).not.toHaveProperty("submissions");
    return { options: snapshot.session!.round!.config.options, gameId: snapshot.session!.round!.minigameId, gameName };
  }
  async function choose(page: Page, label: string) {
    const round = latest.get(host)?.session?.round;
    const choice = round?.config.options.find((option) => option.label === label)?.id;
    expect(choice).toBeTruthy();
    const startingBeat = round?.beat?.index;
    await page.locator(".choice-button").getByText(label, { exact: true }).first().click();
    await expect.poll(() => {
      const current = latest.get(page)?.session?.round;
      return current?.myChoice === choice || (startingBeat === 0 && current?.beat?.index === 1);
    }, { timeout: 60000 }).toBe(true);
    if (startingBeat === 0 && latest.get(host)?.session?.round?.beat?.index === 1) {
      const order = latest.get(host)?.session?.round?.firstCommitPlayerId;
      const secondBeatOrder = order ? [pages.find(candidate => latest.get(candidate)?.me === order)!, ...pages.filter(candidate => latest.get(candidate)?.me !== order)] : pages;
      for (const candidate of secondBeatOrder) {
        await expect(candidate.locator(".choice-button:not(:disabled)").first()).toBeEnabled({ timeout: 60000 });
        await candidate.locator(".choice-button:not(:disabled)").first().click();
        await expect.poll(() => latest.get(candidate)?.session?.round?.myChoice, { timeout: 60000 }).toBeTruthy();
      }
    }
  }
  async function finishRound(rule: string) {
    await expect(host.locator(".reveal-groups")).toBeVisible({ timeout: 60000 });
    await expect(host.locator(".reveal-row")).toHaveCount(3);
    await expect.poll(() => latest.get(host)?.session?.phase, { timeout: 60000 }).toBe("game-results");
    if (latest.get(host)!.session!.gameNumber === latest.get(host)!.session!.gameSlots.length) {
      await host.getByRole("button", { name: "See final results" }).click();
      await expect.poll(() => latest.get(host)?.session?.phase, { timeout: 60000 }).toBe("final-results");
      return;
    }
    const winnerId = latest.get(host)!.session!.ruleWinnerId!;
    const winnerPage = pages.find((page) => latest.get(page)?.me === winnerId)!;
    await expect(winnerPage.getByRole("button", { name: "Choose a House Rule" })).toBeVisible({ timeout: 60000 });
    await winnerPage.getByRole("button", { name: "Choose a House Rule" }).click();
    await expect.poll(() => winnerPage.locator(".rule-card").count(), { timeout: 60000 }).toBeGreaterThan(0);
    for (const page of pages.filter((candidate) => candidate !== winnerPage)) await expect(page.locator(".rule-card").first()).toBeDisabled();
    const offers = latest.get(winnerPage)!.session!.offeredRules;
    const requested = offers.find((offer) => offer.name === rule);
    const selected = requested ?? offers[0];
    const card = winnerPage.locator(".rule-card").filter({ hasText: selected.name }).first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(host.locator(".intermission")).toBeVisible({ timeout: 60000 });
    await expect(host.locator(".house-rule-panel")).toContainText(selected.name, { timeout: 60000 });
  }

  await host.getByRole("button", { name: "Start the party" }).click();
  await expect(host.getByRole("button", { name: "Start game 1" })).toBeVisible();
  await expect.poll(() => latest.get(host)?.session).not.toBeNull();
  const selectedGames = latest.get(host)!.session!.gameSlots;
  expect(selectedGames).toHaveLength(6);
  expect(new Set(selectedGames).size).toBe(6);
  expect(new Set(selectedGames.map((id) => MINIGAMES[id].director?.family)).size).toBeGreaterThanOrEqual(4);
  await expect.poll(() => pages.every((page) => Boolean(latest.get(page)?.session?.myObjective)), { timeout: 60000 }).toBe(true);
  for (const page of pages) {
    expect(latest.get(page)?.session?.myObjective).toBeTruthy();
    expect(latest.get(page)?.session).not.toHaveProperty("objectives");
    expect(latest.get(page)?.session).not.toHaveProperty("seed");
    expect(latest.get(page)?.session?.objectiveReveal).toBeUndefined();
  }
  const byId = (id: string) => pages.find((page) => latest.get(page)?.me === id)!;
  async function firstCommitPage() {
    const playerId = latest.get(host)?.session?.round?.firstCommitPlayerId;
    if (!playerId) return null;
    await expect.poll(() => pages.some((page) => latest.get(page)?.me === playerId), { timeout: 60000 }).toBe(true);
    const page = byId(playerId);
    expect(page).toBeTruthy();
    return page;
  }
  const labelFor = (gameId: string, playerName: string, options: GameOption[]) => {
    if (gameId === "split-decision") return playerName === "Host" ? "RED" : "BLUE";
    if (gameId === "make-it-worse") return playerName === "Host" ? options[0].label : options[1].label;
    if (gameId === "trust-me") return ({ Host: "POOL IT", Alex: "DOUBLE OR NOTHING", Blair: "SWIPE THE BAG" } as Record<string, string>)[playerName];
    if (gameId === "pile-on") return playerName === "Host" ? "DUCK FOR COVER" : "CALL OUT Host";
    if (gameId === "secret-handshake") return ({ Host: "REACH FOR Blair", Alex: "REACH FOR Host", Blair: "REACH FOR Host" } as Record<string, string>)[playerName];
    if (gameId === "hot-potato") return ({ Host: "PASS TO Alex", Alex: "PASS TO Blair", Blair: "TAKE THE HEAT" } as Record<string, string>)[playerName];
    if (gameId === "group-tab") return ({ Host: "SPLIT IT FAIR", Alex: "TAKE THE BIG SLICE", Blair: "BURN YOUR RECEIPT" } as Record<string, string>)[playerName];
    if (gameId === "escalation-ladder") return ({ Host: "RISK 3", Alex: "RISK 3", Blair: "RISK 1" } as Record<string, string>)[playerName];
    if (gameId === "bluff-check") return ({ Host: "TOTALLY TRUE", Alex: "CALL THE BLUFF", Blair: "TOTALLY TRUE" } as Record<string, string>)[playerName];
    if (gameId === "favor-bank") return ({ Host: "BACK Alex", Alex: "BACK Host", Blair: "KEEP YOUR OWN COUNSEL" } as Record<string, string>)[playerName];
    if (gameId === "auction-house") return ({ Host: "BID 2", Alex: "BID 1", Blair: "PASS" } as Record<string, string>)[playerName];
    if (gameId === "lifeline") return ({ Host: "SAVE Alex", Alex: "SAVE Host", Blair: "SAVE Host" } as Record<string, string>)[playerName];
    if (gameId === "group-project") return ({ Host: "HELP", Alex: "CARRY", Blair: "SKIP" } as Record<string, string>)[playerName];
    if (gameId === "prisoners-dilemma") return ({ Host: "COOPERATE", Alex: "DEFECT", Blair: "COOPERATE" } as Record<string, string>)[playerName];
    if (gameId === "split-the-difference") return ({ Host: "2", Alex: "2", Blair: "3" } as Record<string, string>)[playerName];
    if (gameId === "golden-ticket") return ({ Host: "BACK Alex", Alex: "BACK Alex", Blair: "BACK Host" } as Record<string, string>)[playerName];
    if (["cross-my-heart", "signal-noise", "last-seats", "breaking-point"].includes(gameId)) return options[playerName === "Host" ? 0 : 1]?.label;
    throw new Error(`Unexpected game ${gameId}`);
  };
  const ruleByRound = ["First on the Record", "Soft Landing", "Double Down", "Bounty", "Underdog", "Double Down"];
  for (let number = 1; number <= 6; number++) {
    const { options, gameId } = await startRound(number);
    if (gameId === "make-it-worse") expect(latest.get(host)?.session?.round?.config.promptId).toBeTruthy();
    if (gameId === "lifeline") expect(options).toHaveLength(3);
    if (["trust-me", "pile-on", "secret-handshake", "hot-potato", "favor-bank"].includes(gameId)) {
      expect(options.length).toBeGreaterThanOrEqual(4);
    }
    if (number === 4) {
      const activeIds = latest.get(host)!.session!.activeRules.map((rule) => rule.id);
      expect(activeIds.length).toBeGreaterThanOrEqual(2);
      await expect(host.locator(".active-rule")).toHaveCount(activeIds.length);
    }
    if (number === 1) {
      const privateObjective = latest.get(host)!.session!.myObjective;
      const powerId = latest.get(host)!.session!.myPowerOffers.find((id) => !POWERS[id].targetRequired)!;
      const power = POWERS[powerId];
      await host.locator(".power-option").filter({ hasText: power.name }).getByRole("button", { name: `Use · ${power.cost}` }).click();
      await expect.poll(() => latest.get(host)?.session?.myChaos).toBe(2 - power.cost);
      await expect.poll(() => latest.get(host)?.session?.myPowers.length).toBe(1);
      expect(latest.get(host)?.session?.myObjective).toEqual(privateObjective);
      expect(latest.get(guestOne)?.session?.myChaos).toBe(2);
      expect(latest.get(guestOne)?.session?.myPowers).toEqual([]);
    }
    const round = latest.get(host)!.session!.round!;
    const firstPage = await firstCommitPage();
    const orderedPages = firstPage ? [firstPage, ...pages.filter((page) => page !== firstPage)] : pages;
    if (number === 2) {
      const commitPage = firstPage ?? pages[0];
      if (round.firstCommitPlayerId) {
        const waitingPage = pages.find((page) => page !== commitPage)!;
        await expect(waitingPage.locator(".first-commit-note")).toBeVisible();
        await expect(waitingPage.locator(".choice-button").first()).toBeDisabled();
      }
      const commitName = latest.get(commitPage)!.players.find((player) => player.id === latest.get(commitPage)!.me)?.name ?? "Host";
      const commitLabel = labelFor(gameId, commitName, options);
      await choose(commitPage, commitLabel);
      const reconnectPage = pages.find((page) => page !== commitPage)!;
      const objectiveBeforeReload = latest.get(reconnectPage)?.session?.myObjective;
      await reconnectPage.reload();
      await expect(reconnectPage.locator(".connection")).toHaveText("Connected");
      if (round.firstCommitPlayerId) await expect(reconnectPage.locator(".active-rule")).toContainText("First on the Record");
      expect(latest.get(reconnectPage)?.session?.round?.myChoice).toBeNull();
      expect(latest.get(reconnectPage)?.session?.round).not.toHaveProperty("submissions");
      expect(latest.get(reconnectPage)?.session?.myObjective).toEqual(objectiveBeforeReload);
      for (const page of pages.filter((candidate) => candidate !== commitPage)) await choose(page, labelFor(gameId, latest.get(page)!.players.find((player) => player.id === latest.get(page)!.me)?.name ?? "", options));
    } else {
      for (const page of orderedPages) {
        const playerName = latest.get(page)!.players.find((player) => player.id === latest.get(page)!.me)?.name ?? "";
        await choose(page, labelFor(gameId, playerName, options));
      }
    }
    // A two-beat game's public reveal is also rendered during beat 2. The
    // first-beat transition may happen while the final page's action is still
    // syncing, so make any uncommitted second-beat choice explicit here.
    if (latest.get(host)?.session?.round?.beat?.index === 1) {
      for (const page of pages) {
        if (latest.get(page)?.session?.phase !== "active-game" || latest.get(page)?.session?.round?.myChoice) continue;
        const available = page.locator(".choice-button:not(:disabled)").first();
        if (await available.count()) await available.click();
        await expect.poll(() => latest.get(page)?.session?.round?.myChoice || latest.get(page)?.session?.phase === "game-results", { timeout: 60000 }).toBe(true);
      }
    }
    await expect(host.locator(".reveal-groups")).toBeVisible({ timeout: 60000 });
    await expect(host.locator(".reveal-row")).toHaveCount(3);
    await expect.poll(() => latest.get(host)?.session?.phase, { timeout: 60000 }).toBe("game-results");
    await finishRound(ruleByRound[number - 1]);
    if (gameId === "make-it-worse") expect(latest.get(host)?.session?.round?.result?.events.some((event) => event.type === "read")).toBe(true);
    if (gameId === "trust-me") expect(latest.get(host)?.session?.round?.result?.events.some((event) => event.type === "betrayal")).toBe(true);
    if (gameId === "secret-handshake") expect(latest.get(host)?.session?.round?.result?.events.some((event) => event.type === "betrayed")).toBe(true);
    if (gameId === "favor-bank") expect(latest.get(host)?.session?.round?.result?.events.some((event) => event.type === "alliance" && event.mutual)).toBe(true);
    if (gameId === "lifeline") expect(latest.get(host)?.session?.round?.result?.events.some((event) => event.type === "save" && event.successful)).toBe(true);
    if (gameId === "group-project") expect(latest.get(host)?.session?.round?.result?.events.some((event) => event.type === "contribution")).toBe(true);
    if (gameId === "golden-ticket") expect(latest.get(host)?.session?.round?.result?.events.some((event) => event.type === "support")).toBe(true);
  }
  await expect(host.getByText("SESSION COMPLETE · 6 GAMES")).toBeVisible();
  expect(latest.get(host)?.session?.awards.length).toBeGreaterThan(0);
  await expect(host.locator(".standing-row").first()).toBeVisible();
  expect(latest.get(host)?.session?.objectiveReveal).toBeUndefined();
  await host.getByRole("button", { name: "Reveal secret objectives" }).click();
  await expect(host.locator(".objective-result")).toHaveCount(3);
  expect(latest.get(host)?.session?.objectiveReveal).toBeTruthy();
  await host.getByRole("button", { name: "Reveal party awards" }).click();
  await expect(host.locator(".rule-explainer").getByText(/Most Targeted:|Best Read:|Biggest Gambler:|Worst Ally:|Chaos Agent:|Best Ally:/).first()).toBeVisible();
  await host.getByRole("button", { name: "Reveal session records" }).click();
  await expect(host.locator(".score-paths")).toContainText("Score progression");
  for (const page of pages) {
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  }
  expect(runtimeErrors).toEqual([]);

  await host.getByRole("button", { name: "Run it back with new games" }).click();
  await expect(host.getByRole("button", { name: "Start game 1" })).toBeVisible();
  const retry = latest.get(host)!;
  expect(retry.session?.gameSlots).not.toEqual(selectedGames);
  expect(retry.session?.myChaos).toBe(2);
  expect(retry.session?.myPowers).toEqual([]);
  expect(retry.session?.activeRules).toEqual([]);
  expect(retry.session?.myObjective).toBeTruthy();
  expect(retry.players).toHaveLength(3);
  for (const page of pages) {
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
  }
  for (let number = 1; number <= 6; number++) {
    const { options, gameId } = await startRound(number);
    const firstPage = await firstCommitPage();
    const orderedPages = firstPage ? [firstPage, ...pages.filter((page) => page !== firstPage)] : pages;
    for (const page of orderedPages) {
      const playerName = latest.get(page)!.players.find((player) => player.id === latest.get(page)!.me)?.name ?? "";
      await choose(page, labelFor(gameId, playerName, options));
    }
    if (latest.get(host)?.session?.round?.beat?.index === 1) {
      for (const page of pages) {
        if (latest.get(page)?.session?.phase !== "active-game" || latest.get(page)?.session?.round?.myChoice) continue;
        const available = page.locator(".choice-button:not(:disabled)").first();
        if (await available.count()) await available.click();
        await expect.poll(() => latest.get(page)?.session?.round?.myChoice || latest.get(page)?.session?.phase === "game-results", { timeout: 60000 }).toBe(true);
      }
    }
    await expect.poll(() => latest.get(host)?.session?.phase).toBe("game-results");
    await finishRound("");
  }
  await expect(host.getByText("SESSION COMPLETE · 6 GAMES")).toBeVisible();
  expect(latest.get(host)?.session?.history).toHaveLength(6);
  expect(latest.get(host)?.session?.objectiveReveal).toBeUndefined();
  expect(latest.get(host)?.session?.awards.length).toBeGreaterThan(0);
  await host.getByRole("button", { name: "Leave room" }).click();
  await expect(host.getByLabel("Your name")).toHaveValue("Host");
});
