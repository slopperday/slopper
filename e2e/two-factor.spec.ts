import { mkdirSync } from "node:fs";
import type { Page } from "@playwright/test";
import { api } from "../convex/_generated/api.js";
import { codeFor, stepAt } from "../app/.server/auth/totp.ts";
import { hashToken, randomToken } from "../app/.server/encoding.ts";
import { expect, test } from "./fixtures.ts";

/**
 * Two-step sign-in: setting up an authenticator app, recovery codes, and a
 * second session confirming it's its owner before making an API token.
 * (Passkeys need a real domain for WebAuthn, not the stack's 127.0.0.1.)
 */

const SHOTS = process.env.STUDIO_SCREENSHOTS ? "docs/security" : null;

async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test("an authenticator app turns on two-step sign-in, and sensitive actions ask again", async ({
  seed,
  convex,
  stack,
  browser,
}) => {
  const owner = await seed.user("guarded");
  const page = await seed.pageAs(owner);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/settings/security");
  await expect(page.getByRole("heading", { name: "Two-step sign-in is off" })).toBeVisible();

  await page.getByRole("button", { name: "Set up an authenticator app" }).click();
  const secret = (await page.getByLabel("Setup key").textContent())!.replace(/\s/g, "");
  await expect(page.getByAltText("QR code for your authenticator app")).toBeVisible();
  await shoot(page, "1-authenticator-setup");
  await page.getByLabel("The code it shows").fill("000000");
  await page.getByRole("button", { name: "Turn it on" }).click();
  await expect(page.getByRole("alert")).toContainText("didn't match");
  // The same key still works after a wrong code.
  expect((await page.getByLabel("Setup key").textContent())!.replace(/\s/g, "")).toBe(secret);
  await page.getByLabel("The code it shows").fill(codeFor(secret, stepAt(Date.now())));
  await page.getByRole("button", { name: "Turn it on" }).click();
  await expect(page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem")).toHaveCount(10);
  const codes = await page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem").allTextContents();
  expect(codes).toHaveLength(10);
  await shoot(page, "2-recovery-codes");
  await page.goto("/settings/security");
  await expect(page.getByRole("heading", { name: "Two-step sign-in is on" })).toBeVisible();
  expect(await page.content()).not.toContain(secret);

  // A second browser, signed in before the app was added, hasn't proved itself.
  const token = randomToken();
  await convex.mutation(api.users.createSession, {
    userId: owner.id,
    tokenHash: await hashToken(token),
    expiresAt: Date.now() + 86_400_000,
  });
  const context = await browser.newContext();
  await context.addCookies([{ name: "slopper_session", value: token, url: stack.appUrl }]);
  const other = await context.newPage();
  await other.setViewportSize({ width: 1280, height: 900 });
  await other.goto("/settings/api");
  await other.getByLabel("Token name").fill("laptop");
  await other.getByRole("button", { name: "Create token" }).click();
  await expect(other).toHaveURL(/\/login\/verify\?confirm=1/);
  await expect(other.getByRole("heading", { name: "Confirm it’s you" })).toBeVisible();
  await shoot(other, "3-confirm-its-you");
  await other.getByLabel("Code from your authenticator app").fill("123456");
  await other.getByRole("button", { name: "Continue" }).click();
  await expect(other.getByRole("alert")).toContainText("didn't match");
  // A recovery code works once.
  await other.getByLabel("Code from your authenticator app").fill(codes[0].toUpperCase());
  await other.getByRole("button", { name: "Continue" }).click();
  await expect(other).toHaveURL(/\/settings\/api$/);
  await other.getByLabel("Token name").fill("laptop");
  await other.getByRole("button", { name: "Create token" }).click();
  await expect(other.getByRole("button", { name: "Reveal token" })).toBeVisible();

  await other.goto("/settings/security");
  await expect(other.getByText("9 of 10 left.")).toBeVisible();
  await expect(other.getByText("A recovery code was used; 9 left")).toBeVisible();
  await shoot(other, "4-security-page");
  // Sign out the first browser from the second.
  await other.getByRole("button", { name: "Sign out everywhere else" }).click();
  await expect(other.getByText("Signed out 1 other session.")).toBeVisible();
  await page.goto("/settings/security");
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});
