import { defineConfig } from "@playwright/test";
import { getEnvironmentSafety } from "./lib/environment-safety.mjs";

if (!process.env.VERCEL_ENV) {
  process.env.BETA_DEPLOYMENT_CLASS ??= "test";
  process.env.NEXT_PUBLIC_DEPLOYMENT_CLASS ??= "test";
}
if (process.env.NEXT_PUBLIC_SUPABASE_URL && !getEnvironmentSafety().browserTestAllowed) {
  throw new Error("Playwright refused an unapproved or production Supabase project.");
}

export default defineConfig({
  testDir: "tests",
  testMatch: ["live.spec.ts", "party.spec.ts", "multibeat.spec.ts", "reconnect.spec.ts", "deadline.spec.ts", "mobile-edge.spec.ts"],
  timeout: 360000,
  expect: { timeout: 12000 },
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox"] } }
      : {}),
  },
  reporter: "list",
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 180000,
      },
});
