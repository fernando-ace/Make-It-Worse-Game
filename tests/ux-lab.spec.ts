import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

test("UX Lab renders deterministic fixtures without contacting room services", async ({ page }) => {
  const serviceCalls: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/api/room") || request.url().includes("supabase")) serviceCalls.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ux-lab?state=target-picker");
  await expect(page.getByRole("heading", { name: "Who gets your power?" })).toBeVisible();
  await expect(page.locator(".player-chip")).toHaveCount(7);
  await page.getByRole("button", { name: /Alexandra Verylongname/ }).click();
  await expect(page.getByRole("button", { name: /Alexandra Verylongname/ })).toHaveAttribute("aria-pressed", "true");
  const mobile = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.width);
  expect(serviceCalls).toEqual([]);
});

test("UX Lab remains navigable and overflow-free at party-night review sizes", async ({ page }) => {
  for (const viewport of [{ width: 390, height: 640 }, { width: 430, height: 932 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const state of ["landing", "join-error", "lobby-8", "game-intro", "single-choice", "target-picker", "waiting", "public-reveal", "private-report", "objective", "powers", "low-chaos", "house-rule", "score-swing", "intermission", "finale", "awards", "reconnect", "room-expired"]) {
      await page.goto(`/ux-lab?state=${state}`);
      await expect(page.getByRole("combobox", { name: "Preview state" })).toHaveValue(state);
      const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
      expect(dimensions.scrollWidth, `${state} at ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(dimensions.width);
    }
  }
});

test("public and private beat details have distinct labels and reduced motion is honored", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/ux-lab?state=private-report");
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  await expect(page.getByText("EVERYONE CAN SEE", { exact: true })).toBeVisible();
  await expect(page.locator(".private-report .info-visibility.private")).toContainText("ONLY YOU CAN SEE");
  const duration = await page.locator(".choice-button").first().evaluate(element => getComputedStyle(element).transitionDuration);
  expect(duration.split(",").every(value => Number.parseFloat(value) <= 0.001)).toBe(true);
  await page.locator(".choice-button").first().focus();
  expect(await page.locator(".choice-button").first().evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
});

test("low Chaos explains unavailable powers and the objective stays private and reopenable", async ({ page }) => {
  await page.goto("/ux-lab?state=low-chaos");
  await page.locator(".chaos-tools summary").click();
  await expect(page.getByText(/Need \d+ more Chaos to use this\./).first()).toBeVisible();
  expect(await page.locator(".power-option button:disabled").count()).toBeGreaterThan(0);
  await page.goto("/ux-lab?state=objective");
  const objective = page.locator(".secret-objective");
  await expect(objective.locator("summary")).toContainText("PRIVATE");
  await objective.locator("summary").click();
  await expect(objective).toContainText("Target Jordan twice before the session ends.");
});

test("targeted powers use player identity choices with an unmistakable selected state", async ({ page }) => {
  await page.goto("/ux-lab?state=powers");
  await page.locator(".chaos-tools summary").click();
  const picker = page.locator(".power-target-picker").first();
  await expect(picker).toBeVisible();
  const choices = picker.locator(".player-chip");
  expect(await choices.count()).toBe(3);
  await choices.nth(1).click();
  await expect(choices.nth(1)).toHaveAttribute("aria-pressed", "true");
});

test("fixture actions change only the preview and never send a room action", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", request => requests.push(request.url()));
  await page.goto("/ux-lab?state=landing");
  await page.getByLabel("Your name").fill("Jamie");
  await page.getByRole("button", { name: "Create game" }).click();
  await expect(page.locator(".entry-card [role=alert]")).toHaveText("Fixture only. No room was created.");
  await page.goto("/ux-lab?state=powers");
  await page.locator(".chaos-tools summary").click();
  await page.locator(".power-option button:not(:disabled)").first().click();
  await expect(page.locator(".fixture-action-message")).toContainText("No room state or service was changed.");
  await page.goto("/ux-lab?state=house-rule");
  await page.getByRole("button", { name: /First on the Record/ }).click();
  await expect(page.locator(".fixture-action-message")).toContainText("Selected fixture rule");
  await page.goto("/ux-lab?state=finale");
  await page.getByRole("button", { name: /Run it back/ }).click();
  await expect(page.getByRole("heading", { name: "They’re all here." })).toBeVisible();
  expect(requests.some(url => url.includes("/api/room") || url.includes("supabase"))).toBe(false);
});

test("UX Lab can capture the responsive visual review matrix on demand", async ({ page }) => {
  test.skip(process.env.UX_LAB_CAPTURE !== "1", "Set UX_LAB_CAPTURE=1 to write the review screenshots under work/.");
  const output = resolve("work/ux-lab-review");
  mkdirSync(output, { recursive: true });
  const viewports = [{ width: 390, height: 844 }, { width: 430, height: 932 }, { width: 390, height: 640 }, { width: 844, height: 390 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }];
  const fixtures = ["landing", "lobby-4", "lobby-8", "game-intro", "single-choice", "target-picker", "waiting", "public-reveal", "private-report", "objective", "powers", "house-rule", "score-swing", "intermission", "finale", "awards", "reconnect", "room-expired"];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const fixture of fixtures) {
      await page.goto(`/ux-lab?state=${fixture}`);
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      await page.screenshot({ path: resolve(output, `${fixture}-${viewport.width}x${viewport.height}.png`), fullPage: true });
    }
  }
});
