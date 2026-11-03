import { api } from "../convex/_generated/api.js";
import { expect, test } from "./fixtures.ts";

test("brand accounts stay separate and X credentials never appear in settings HTML", async ({ seed, convex }) => {
  const owner = await seed.user("brands");
  const product = await seed.slop(owner);
  const secret = "sealed-private-brand-credentials";
  for (const remoteId of ["111", "222"]) {
    await convex.mutation(api.accounts.connect, {
      userId: owner.id,
      provider: "x",
      remoteId,
      handle: `brand${remoteId}`,
      displayName: "Brand",
      avatarUrl: null,
      sealedCredentials: secret,
      expiresAt: null,
      initialMode: "off",
    });
  }
  const page = await seed.pageAs(owner);
  await page.goto("/settings/autopost");
  await expect(page.getByText("brand111", { exact: true })).toBeVisible();
  await expect(page.getByText("brand222", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect X with my credentials" })).toBeVisible();
  expect(await page.content()).not.toContain(secret);
  for (const label of ["API Key", "API Key Secret", "Access Token", "Access Token Secret"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute("type", "password");
    await page.getByLabel(label, { exact: true }).fill("invalid credential with spaces");
  }
  await page.getByRole("button", { name: "Connect X with my credentials" }).click();
  await expect(page.getByRole("alert")).toHaveText("X needs all four credentials, with no spaces.");
  expect(await page.content()).not.toContain("invalid credential with spaces");
  expect(await convex.query(api.accounts.list, { userId: owner.id })).toHaveLength(2);

  await page.goto(`${product.path}/edit#autopost`);
  const settings = page.locator("#autopost");
  await expect(settings).toContainText("brand111");
  await expect(settings).toContainText("brand222");
  expect(await page.content()).not.toContain(secret);
  const brand = settings.locator(".panel").filter({ hasText: "brand111" });
  await brand
    .locator("label")
    .filter({ hasText: /^Post$/ })
    .click();
  await settings.getByRole("button", { name: "Save auto-post" }).click();
  await page.goto(`${product.path}/edit#autopost`);
  await expect(
    page.locator("#autopost .panel").filter({ hasText: "brand111" }).getByLabel("Post", { exact: true }),
  ).toBeChecked();
  await expect(
    page.locator("#autopost .panel").filter({ hasText: "brand222" }).getByLabel("Off", { exact: true }),
  ).toBeChecked();
});
