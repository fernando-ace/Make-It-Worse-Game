import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { existsSync } from "node:fs";
import type { Snapshot } from "../lib/types";
import { expectEphemeralSupabase, interruptAndReconnect, observeRoomSnapshots, reconnectByReload } from "./helpers/reconnect";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

test("single-beat reconnect preserves phase, identity, deadline, and private state through result", async ({ browser }) => {
  expect(process.env.NEXT_PUBLIC_SUPABASE_URL).toBeTruthy();
  expectEphemeralSupabase();
  expect(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBeTruthy();
  expect(process.env.SUPABASE_SECRET_KEY).toBeTruthy();
  expect(process.env.E2E_TEST_MODE).toBe("1");
  expect(process.env.E2E_TEST_GAME_ID).toBe("split-decision");

  const contexts: BrowserContext[] = [await browser.newContext(), await browser.newContext()];
  const pages: Page[] = await Promise.all(contexts.map(context => context.newPage()));
  let room: { id: string; code: string } | undefined;
  const ids = new Set<string>();
  const snapshots = new Map<Page, Snapshot>();
  for (const page of pages) observeRoomSnapshots(page, snapshot => { snapshots.set(page, snapshot); ids.add(snapshot.me); });
  const [host, guest] = pages;
  try {
    await Promise.all(pages.map(async page => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/");
      await expect(page.locator(".connection")).toHaveText("Connected");
    }));
    await host.getByLabel("Your name").fill("Host");
    await host.getByRole("button", { name: "Create game" }).click();
    await expect(host.getByRole("heading", { name: "The room is yours." })).toBeVisible();
    const code = await host.locator(".room-banner strong").innerText();
    room = { id: snapshots.get(host)!.id, code };
    await guest.getByLabel("Your name").fill("Guest");
    await guest.getByLabel("Room code").fill(code);
    await guest.getByRole("button", { name: "Join game" }).click();
    await expect(host.locator(".player-row")).toHaveCount(2);

    const lobby = await reconnectByReload(guest, () => snapshots.get(guest));
    expect(lobby.after.players.map(player => player.id)).toContain(lobby.before.me);
    await host.getByRole("button", { name: "Start the party" }).click();
    await expect(host.getByRole("button", { name: "Start game 1" })).toBeVisible();
    const offline = await interruptAndReconnect(guest.context(), guest, () => snapshots.get(guest));
    expect(offline.after.session?.phase).toBe("game-intro");
    expect(offline.after.session?.round).toBeNull();

    await host.getByRole("button", { name: "Start game 1" }).click();
    await expect.poll(() => snapshots.get(host)?.session?.phase).toBe("active-game");
    const beforeCommit = await reconnectByReload(host, () => snapshots.get(host));
    expect(beforeCommit.after.session?.round?.minigameId).toBe("split-decision");
    const hostId = beforeCommit.after.me;
    const guestId = snapshots.get(guest)!.me;
    const deadline = beforeCommit.after.session!.round!.deadlineAt;
    const objective = beforeCommit.after.session!.myObjective;
    await host.locator(".choice-button:not(:disabled)").first().click();
    await expect.poll(() => snapshots.get(host)?.session?.round?.myChoice).toBeTruthy();

    const committed = await reconnectByReload(host, () => snapshots.get(host));
    expect(committed.after.me).toBe(hostId);
    expect(committed.after.session?.round?.deadlineAt).toBe(deadline);
    expect(committed.after.session?.myObjective).toEqual(objective);
    expect(committed.after.session?.round?.myChoice).toBeTruthy();
    const guestBeforeCommit = snapshots.get(guest)!;
    expect(guestBeforeCommit.session?.round?.myChoice).toBeNull();
    expect(guestBeforeCommit.session?.round).not.toHaveProperty("submissions");
    expect(guestBeforeCommit.session).not.toHaveProperty("seed");
    expect(guestBeforeCommit.session).not.toHaveProperty("objectives");
    expect(guestBeforeCommit.session).not.toHaveProperty("activePowers");

    await guest.locator(".choice-button:not(:disabled)").nth(1).click();
    await expect.poll(() => snapshots.get(guest)?.session?.phase).toBe("game-results");
    const result = await reconnectByReload(guest, () => snapshots.get(guest));
    expect(result.after.me).toBe(guestId);
    expect(result.after.session?.phase).toBe("game-results");
    expect(result.after.session?.history).toHaveLength(1);
    expect(result.after.session?.round?.result?.choices).toHaveProperty(hostId);
    expect(result.after.session?.round?.result?.choices).toHaveProperty(guestId);
  } finally {
    await Promise.all(contexts.map(context => context.close().catch(() => {})));
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (url && key) {
      const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      if (room) await db.from("cr_rooms").delete().eq("id", room.id).eq("code", room.code);
      for (const userId of ids) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) continue;
        await db.auth.admin.deleteUser(userId);
      }
    }
  }
});
