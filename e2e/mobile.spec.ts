import { expect, test } from "./fixtures.ts";

test.describe("on a phone", () => {
  test("pages fit the screen and the nav scrolls instead of overflowing", async ({ page, seed }) => {
    const maker = await seed.user("pocket");
    const slop = await seed.slop(maker);
    for (const path of ["/", "/today", "/wall", "/rules", "/login", slop.path, `/@${maker.username}`]) {
      await page.goto(path);
      // clientWidth, not innerWidth: mobile Chrome widens the layout viewport to fit overflow.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
    const nav = page.getByRole("navigation", { name: "Main mobile" });
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: "Streaks" }).click();
    await expect(page).toHaveURL("/streaks");
  });

  test("a maker can launch from a phone", async ({ seed }) => {
    const page = await seed.pageAs(await seed.user("thumbs"));
    await page.goto("/new");
    const name = `Pocket ${Date.now().toString(36)}`;
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Tagline").fill("Made on a phone");
    await page.getByLabel("Link 1 address").fill("https://pocket.example/");
    await page.getByLabel("Category").selectOption("utilities");
    await page.getByRole("button", { name: "Throw it at the wall" }).click();
    await expect(page.getByRole("status")).toHaveText(`${name} is on the wall.`);
  });
});
