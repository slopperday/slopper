import { defineConfig, devices } from "@playwright/test";
import { PORTS } from "./e2e/ports.ts";

/**
 * The Studio walkthrough video: `vp build`, then
 * `vp exec playwright test -c playwright.demo.config.ts`. It runs the e2e
 * stack with stand-ins for GitHub, X and LinkedIn (e2e/demo/fake-networks.ts)
 * and leaves the recording in `test-results/`.
 */
export default defineConfig({
  testDir: "e2e/demo",
  testMatch: /\.demo\.ts$/,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${PORTS.app}`,
    timezoneId: "UTC",
    actionTimeout: 15_000,
    viewport: { width: 1440, height: 900 },
    video: { mode: "on", size: { width: 1440, height: 900 } },
    launchOptions: { slowMo: 120 },
  },
  webServer: {
    command: "node e2e/stack.ts",
    env: { E2E_APP_IMPORT: "e2e/demo/fake-networks.ts" },
    url: `http://127.0.0.1:${PORTS.app}/rules`,
    timeout: 120_000,
    stdout: "pipe",
  },
});
