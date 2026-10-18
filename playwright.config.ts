import { defineConfig, devices } from "@playwright/test";
import process from "node:process";
import { PORTS } from "./e2e/ports.ts";

/**
 * End-to-end journeys against the production build, a fresh Convex backend
 * and a fake content check (see e2e/stack.ts). Run with `vp run e2e`, which
 * builds first. `E2E_REUSE=1` reuses a stack you already started with
 * `node e2e/stack.ts`, for quick iterations.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: true,
  // Local CI: a flaky test is a bug to fix, not to retry past.
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: `http://127.0.0.1:${PORTS.app}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "UTC",
    // Each page's user agent is the device's, but requests a page leaves to
    // finish after it's gone (analytics' leave beacons) carry the browser's
    // own, which says HeadlessChrome: analytics drops those as a bot's.
    launchOptions: { args: [`--user-agent=${devices["Desktop Chrome"].userAgent}`] },
  },
  webServer: {
    command: "node e2e/stack.ts",
    url: `http://127.0.0.1:${PORTS.app}/rules`,
    reuseExistingServer: process.env.E2E_REUSE === "1",
    timeout: 120_000,
    stdout: "pipe",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
