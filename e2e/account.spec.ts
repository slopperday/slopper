import type { Page } from "@playwright/test";
import { api } from "../convex/_generated/api.js";
import { expect, test } from "./fixtures.ts";

/** The vote count beside the slop page's Upvote button. */
function upvoteCount(page: Page) {
  return page
    .locator("header")
    .getByRole("button", { name: "Upvote" })
    .locator("xpath=..")
    .locator('[aria-live="polite"]');
}

test.describe("your account", () => {
  test("an upvote can be taken back, and the count follows", async ({ seed }) => {
    const slop = await seed.slop(await seed.user("maker"));
    const page = await seed.pageAs(await seed.user("fickle"));
    await page.goto(slop.path);
    const upvote = page.locator("header").getByRole("button", { name: "Upvote" });
    await expect(upvote).toHaveAttribute("aria-pressed", "false");
    await expect(upvoteCount(page)).toHaveText("0");

    await upvote.click();
    await expect(upvote).toHaveAttribute("aria-pressed", "true");
    await expect(upvoteCount(page)).toHaveText("1");
    await upvote.click();
    await expect(upvote).toHaveAttribute("aria-pressed", "false");
    await expect(upvoteCount(page)).toHaveText("0");

    // It stuck: nothing to take back after a reload.
    await page.reload();
    await expect(upvote).toHaveAttribute("aria-pressed", "false");
    await expect(upvoteCount(page)).toHaveText("0");
  });

  test("notifications say what happened, link to the slop, and clear the bell", async ({ seed, convex }) => {
    const maker = await seed.user("noticed");
    const fan = await seed.user("fan");
    const slop = await seed.slop(maker);
    await seed.vote(fan, slop, 1);
    await convex.mutation(api.slops.pledge, { userId: fan.id, slopId: slop.id, amount: 2500 });

    const page = await seed.pageAs(maker);
    await page.goto("/");
    await page.getByRole("link", { name: "Notifications, 2 unread" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Notifications");
    await expect(page.getByText(`@${fan.username} upvoted ${slop.name}`)).toBeVisible();
    await expect(page.getByText(`@${fan.username} pledged $25.00 to ${slop.name}`)).toBeVisible();
    // Seeing them is reading them.
    await expect(page.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();

    await page.getByRole("link", { name: new RegExp(`upvoted ${slop.name}`) }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(slop.name);
  });

  test("people who opt in see NSFW slops in lists, unblurred; everyone else doesn't see them", async ({ seed }) => {
    const id = Date.now().toString(36);
    const maker = await seed.pageAs(await seed.user("moody"));
    await maker.goto("/new");
    const name = `Moody ${id}`;
    await maker.getByLabel("Name").fill(name);
    await maker.getByLabel("Tagline").fill("A mature screenshot for the e2e tests");
    await maker.getByLabel("Link 1 address").fill("https://example.com/");
    await maker.getByLabel("Category").selectOption("utilities");
    await maker
      .locator('input[type="file"][accept*="image"]')
      .setInputFiles({ name: `shot-${id} [e2e:mature].png`, mimeType: "image/png", buffer: await maker.screenshot() });
    await expect(maker.getByRole("img", { name: "Screenshot 1" })).toBeVisible();
    await maker.getByRole("button", { name: "Throw it at the wall" }).click();
    await expect(maker.getByRole("status")).toContainText("It's marked NSFW");

    const viewer = await seed.pageAs(await seed.user("bold"));
    await viewer.goto("/wall");
    await expect(viewer.getByRole("link", { name, exact: true })).toHaveCount(0);

    await viewer.goto("/settings");
    await viewer.getByLabel("Show NSFW slops").check();
    await viewer.getByRole("button", { name: "Save" }).click();
    await expect(viewer.getByRole("status")).toHaveText("Saved.");

    await viewer.goto("/wall");
    await expect(viewer.getByRole("link", { name, exact: true })).toBeVisible();
    const cover = viewer.getByRole("img", { name: `${name} screenshot` });
    await expect(cover).toBeVisible();
    await expect(cover).not.toHaveClass(/blur/);
  });
});
