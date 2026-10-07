import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

async function launch(page: Page, name: string, description: string): Promise<void> {
  await page.goto("/new");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Tagline").fill("A tool for the e2e tests");
  await page.getByLabel("Link 1 address").fill("https://example.com/");
  await page.getByLabel("Category").selectOption("utilities");
  await page.getByLabel("Description").fill(description);
  await page.getByRole("button", { name: "Throw it at the wall" }).click();
}

test.describe("content check", () => {
  test("a mature launch goes up blurred, out of the race, and is never auto-posted", async ({ seed }) => {
    const maker = await seed.user("edgy");
    const page = await seed.pageAs(maker);
    const name = `Grim ${Date.now().toString(36)}`;
    await launch(page, name, "Horror game with realistic gore [e2e:mature]");

    await expect(page.getByRole("status")).toHaveText(`${name} is on the wall. It's marked NSFW, so it's blurred.`);
    await expect(page.getByText("NSFW", { exact: true }).first()).toBeVisible();

    const visitor = await seed.visitorPage();
    await visitor.goto("/today");
    await expect(visitor.getByRole("link", { name, exact: true })).toHaveCount(0);

    // People who opt in see it.
    const fan = await seed.user("fan");
    const fanPage = await seed.pageAs(fan);
    await fanPage.goto("/settings");
    await fanPage.getByRole("checkbox", { name: /Show NSFW slops/ }).check();
    await fanPage.getByRole("button", { name: "Save" }).click();
    await expect(fanPage.getByRole("status")).toHaveText("Saved.");
    await fanPage.goto("/today");
    await expect(fanPage.getByRole("link", { name, exact: true })).toBeVisible();
  });

  test("a blocked launch is held for review and hidden from everyone else", async ({ seed }) => {
    const maker = await seed.user("sketchy");
    const page = await seed.pageAs(maker);
    const name = `Nope ${Date.now().toString(36)}`;
    await launch(page, name, "Definitely not allowed [e2e:blocked]");

    await expect(page.getByRole("alert")).toHaveText(`${name} is held for review. A moderator will look at it.`);
    await expect(page.getByText(/Held for review\. Only you/)).toBeVisible();

    const visitor = await seed.visitorPage();
    const response = await visitor.goto(page.url());
    expect(response?.status()).toBe(404);
  });
});

test.describe("flags and moderation", () => {
  test("three flags blur a slop; a moderator clears it", async ({ seed }) => {
    const mod = await seed.pageAs(await seed.admin());
    const maker = await seed.user("maker");
    const slop = await seed.slop(maker, { name: `Flagged ${Date.now().toString(36)}` });

    // The maker can't flag their own slop.
    const makerPage = await seed.pageAs(maker);
    await makerPage.goto(slop.path);
    await expect(makerPage.getByText("Flag as inappropriate")).toHaveCount(0);

    for (const reason of ["Sexual or adult content", "Gore or violence", "Spam, scam or malware"]) {
      const page = await seed.pageAs(await seed.user("flagger"));
      await page.goto(slop.path);
      await page.getByText("Flag as inappropriate").click();
      await page.getByRole("radio", { name: reason }).check();
      await page.getByLabel("Details").fill(`e2e: ${reason}`);
      await page.getByRole("button", { name: "Flag it" }).click();
      await expect(page.getByRole("status")).toHaveText("Flagged. Thanks, a moderator will look at it.");
      await expect(page.getByText("You flagged this. A moderator will look at it.")).toBeVisible();
    }

    await makerPage.reload();
    await expect(makerPage.getByText("NSFW", { exact: true }).first()).toBeVisible();

    await mod.goto("/mod");
    const item = mod.getByRole("article", { name: slop.name });
    await expect(item.getByText("Sexual or adult content: e2e: Sexual or adult content")).toBeVisible();
    await expect(item.getByText("NSFW")).toBeVisible();
    await item.getByRole("button", { name: "Looks fine" }).click();
    await expect(mod.getByRole("status")).toHaveText(`${slop.name}: Cleared. It's back to normal.`);
    await expect(mod.getByRole("article", { name: slop.name })).toHaveCount(0);

    await makerPage.reload();
    await expect(makerPage.getByText("NSFW", { exact: true })).toHaveCount(0);
  });

  test("a moderator can hide a slop from the queue", async ({ seed }) => {
    const mod = await seed.pageAs(await seed.admin());
    const maker = await seed.user("maker");
    const slop = await seed.slop(maker, { name: `Spam ${Date.now().toString(36)}` });
    const page = await seed.pageAs(await seed.user("flagger"));
    await page.goto(slop.path);
    await page.getByText("Flag as inappropriate").click();
    await page.getByRole("radio", { name: "Spam, scam or malware" }).check();
    await page.getByRole("button", { name: "Flag it" }).click();
    await expect(page.getByRole("status")).toHaveText("Flagged. Thanks, a moderator will look at it.");

    await mod.goto("/mod");
    await mod.getByRole("article", { name: slop.name }).getByRole("button", { name: "Hide it" }).click();
    await expect(mod.getByRole("status")).toHaveText(`${slop.name}: Hidden from Slopper.`);
    const visitor = await seed.visitorPage();
    expect((await visitor.goto(slop.path))?.status()).toBe(404);
  });

  test("the queue is invisible to everyone but moderators", async ({ seed }) => {
    const page = await seed.pageAs(await seed.user("curious"));
    expect((await page.goto("/mod"))?.status()).toBe(404);
    await page.getByLabel("Account menu").click();
    await expect(page.getByRole("link", { name: "Flag queue" })).toHaveCount(0);
  });
});
