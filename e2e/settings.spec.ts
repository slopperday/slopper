import { expect, test } from "./fixtures.ts";

test.describe("settings", () => {
  test("a new username moves the profile and every slop with it", async ({ seed }) => {
    const maker = await seed.user("renamer");
    const slop = await seed.slop(maker);
    const page = await seed.pageAs(maker);
    const next = `${maker.username.slice(0, 24)}-new`;

    await page.goto("/settings");
    await page.getByLabel("Username").fill(next);
    await page.getByLabel("Display name").fill("Renamed Maker");
    await page.getByLabel("Bio").fill("Throwing slop daily.");
    await page.getByLabel("Time zone").selectOption("Europe/London");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");

    await page.goto(`/@${next}`);
    await expect(page.getByText("Renamed Maker").first()).toBeVisible();
    await expect(page.getByText("Throwing slop daily.")).toBeVisible();
    await page.goto(`/@${next}/${slop.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(slop.name);
  });

  test("usernames that are taken or reserved are refused", async ({ seed }) => {
    const taken = await seed.user("taken");
    const page = await seed.pageAs(await seed.user("wannabe"));
    await page.goto("/settings");
    await page.getByLabel("Username").fill(taken.username);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toBeVisible();

    await page.getByLabel("Username").fill("moderator");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("a goal can be dropped and set again", async ({ seed }) => {
    const page = await seed.pageAs(await seed.user("quitter"));
    await page.goto("/goal");
    await page.getByRole("radio", { name: /Warm-up/ }).check({ force: true });
    await page.getByRole("button", { name: "Set the goal" }).click();
    await expect(page.getByRole("status")).toHaveText("Goal set: 7 slops in 7 days. Start throwing.");

    await page.goto("/goal");
    await page.getByText("Drop this goal").click();
    await page.getByRole("button", { name: "Yes, drop it" }).click();
    await expect(page.getByRole("status")).toHaveText("Goal dropped. Set a new one when you're ready.");
    await expect(page.getByRole("heading", { name: "Set a goal" })).toBeVisible();
  });
});
