import type { ConvexHttpClient } from "convex/browser";
import type { Page } from "@playwright/test";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";
import { addDays, formatDay } from "../app/lib/dates.ts";
import { expect, type SeededUser, test } from "./fixtures.ts";

const today = () => new Date().toISOString().slice(0, 10);

/** A launch dated `date` on its maker's clock, as if thrown that day. */
async function launchOn(convex: ConvexHttpClient, owner: SeededUser, name: string, date: string) {
  const { slopId, slug } = await convex.mutation(api.slops.create, {
    userId: owner.id,
    input: {
      name,
      tagline: "Thrown for the e2e tests",
      description: "",
      category: "games",
      links: [{ kind: "website", url: "https://example.com/" }],
      screenshots: [],
      madeWith: [],
    },
    launchNote: "Day one",
    today: date,
  });
  await convex.mutation(api.moderation.applyCheck, { slopId, scope: "slop", verdict: "ok", reason: "Seeded" });
  return { id: slopId as Id<"slops">, slug, name, path: `/@${owner.username}/${slug}` };
}

/** Slop names in the order a page lists them. */
async function order(page: Page, names: readonly string[]): Promise<string[]> {
  const shown = await page.locator("main ol a").allTextContents();
  return shown.map((text) => text.trim()).filter((text) => names.includes(text));
}

test.describe("finding slop", () => {
  test("today's race ranks by net votes, and the lead changes live", async ({ seed }) => {
    const [ada, bo] = [await seed.user("ada"), await seed.user("bo")];
    const leader = await seed.slop(ada);
    const chaser = await seed.slop(bo);
    const fans = [await seed.user("fan"), await seed.user("fan"), await seed.user("fan")];
    await seed.vote(fans[0], leader, 1);

    const page = await seed.visitorPage();
    await page.goto("/today");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today's race");
    await expect.poll(() => order(page, [leader.name, chaser.name])).toEqual([leader.name, chaser.name]);

    // Two upvotes beat one, and a private downvote counts against the old leader.
    await seed.vote(fans[1], chaser, 1);
    await seed.vote(fans[2], chaser, 1);
    await seed.vote(fans[1], leader, -1);
    await expect.poll(() => order(page, [leader.name, chaser.name])).toEqual([chaser.name, leader.name]);
  });

  test("past days are final, and the days link back and forth", async ({ page }) => {
    const yesterday = addDays(today(), -1);
    await page.goto("/today");
    const days = page.getByRole("navigation", { name: "Days" });
    await days.getByRole("link", { name: formatDay(yesterday) }).click();
    await expect(page).toHaveURL(`/day/${yesterday}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Slop of the day: ${formatDay(yesterday)}`);
    await expect(page.getByText(/^Final results\./)).toBeVisible();

    await page.getByRole("navigation", { name: "Days" }).getByRole("link", { name: "Today" }).click();
    await expect(page).toHaveURL("/today");

    // Tomorrow hasn't happened, and nonsense isn't a day.
    expect((await page.goto(`/day/${addDays(today(), 1)}`))?.status()).toBe(404);
    expect((await page.goto("/day/2026-02-30"))?.status()).toBe(404);
  });

  test("the wall shows the freshest slop first, and sorts", async ({ seed }) => {
    const slop = await seed.slop(await seed.user("waller"));
    const page = await seed.visitorPage();
    await page.goto("/wall");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The wall");
    await expect(page.getByRole("link", { name: slop.name, exact: true })).toBeVisible();

    const sort = page.getByRole("navigation", { name: "Sort" });
    await sort.getByRole("link", { name: "Sticking" }).click();
    await expect(sort.getByRole("link", { name: "Sticking" })).toHaveAttribute("aria-current", "true");
  });

  test("category chips pick several at once, from the URL, with select all and clear", async ({ seed }) => {
    const maker = await seed.user("chipper");
    const coin = await seed.slop(maker, { category: "crypto" });
    const course = await seed.slop(maker, { category: "learning" });
    const oddity = await seed.slop(maker, { category: "weird" });

    const page = await seed.visitorPage();
    const shown = (slop: { name: string }) => page.getByRole("link", { name: slop.name, exact: true });
    await page.goto("/wall");
    const categories = page.getByRole("group", { name: "Categories" });
    const chip = (name: string) => categories.getByRole("checkbox", { name, exact: true });
    // Click the chip as people do; the checkbox covering it takes the click.
    const toggle = async (name: string) => await chip(name).locator("xpath=ancestor::label[1]").click();
    await expect(categories.getByRole("checkbox", { checked: true })).toHaveCount(0);

    await toggle("Crypto");
    await expect(chip("Crypto")).toBeChecked();
    await expect(page).toHaveURL("/wall?category=crypto");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Crypto");
    await expect(shown(coin)).toBeVisible();
    await expect(shown(course)).toHaveCount(0);

    await toggle("Learning");
    await expect(page).toHaveURL("/wall?category=learning&category=crypto");
    await expect(page.getByText("Slops filed under Learning or Crypto.")).toBeVisible();
    await expect(shown(coin)).toBeVisible();
    await expect(shown(course)).toBeVisible();
    await expect(shown(oddity)).toHaveCount(0);

    // A checked chip turns off again.
    await toggle("Crypto");
    await expect(chip("Crypto")).not.toBeChecked();
    await expect(page).toHaveURL("/wall?category=learning");
    await expect(shown(coin)).toHaveCount(0);

    // Every toggle is a step back.
    await page.goBack();
    await expect(page).toHaveURL("/wall?category=learning&category=crypto");
    await expect(chip("Crypto")).toBeChecked();

    await categories.getByRole("link", { name: "Select all" }).click();
    await expect(categories.getByRole("checkbox", { checked: false })).toHaveCount(0);
    await expect(page.getByText("Everything that's been thrown.")).toBeVisible();
    await toggle("Weird");
    await expect(chip("Weird")).not.toBeChecked();
    await expect(shown(oddity)).toHaveCount(0);
    await expect(shown(coin)).toBeVisible();

    await categories.getByRole("link", { name: "Clear" }).click();
    await expect(page).toHaveURL("/wall");
    await expect(categories.getByRole("checkbox", { checked: true })).toHaveCount(0);
    await expect(shown(oddity)).toBeVisible();

    // A shared link opens with its chips on.
    await page.goto("/wall?category=weird&category=crypto&category=nope");
    await expect(chip("Weird")).toBeChecked();
    await expect(chip("Crypto")).toBeChecked();
    await expect(categories.getByRole("checkbox", { checked: true })).toHaveCount(2);
  });

  test("search finds slops by meaning as well as words, within the picked chips", async ({ seed, convex }) => {
    const maker = await seed.user("searcher");
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const jar = await seed.slop(maker, { name: `Penny Jar ${id}`, tagline: "Track every expense", category: "money" });
    const leafy = await seed.slop(maker, { name: `Leafy ${id}`, tagline: "Water your plants", category: "health" });
    const maze = await seed.slop(maker, { name: `Marble Maze ${id}`, tagline: "Tilt to roll", category: "games" });
    const held = await seed.slop(maker, { name: `Held ${id}`, tagline: "Track every expense", verdict: "blocked" });
    // Embeddings are made just after each launch: wait until search can see them.
    const finds = async (query: string, slop: { name: string }) =>
      (await convex.action(api.search.find, { query })).some((item) => item.slop.name === slop.name);
    await expect.poll(async () => (await finds("budget", jar)) && (await finds("puzzle", maze))).toBe(true);

    const page = await seed.visitorPage();
    const shown = (slop: { name: string }) => page.getByRole("link", { name: slop.name, exact: true });
    await page.goto("/wall");
    const box = page.getByRole("searchbox", { name: "Search slops" });
    await box.fill("budget");
    await box.press("Enter");
    await expect(page).toHaveURL("/wall?q=budget");
    await expect(page.getByText("Best matches for “budget”.")).toBeVisible();
    // No word in common: it matched on what the slop is for.
    await expect(shown(jar)).toBeVisible();
    await expect(shown(leafy)).toHaveCount(0);
    await expect(shown(held)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Sort" })).toHaveCount(0);

    // Words, then narrowed by a chip: both stay in the URL.
    await box.fill(id);
    await box.press("Enter");
    await expect(page).toHaveURL(`/wall?q=${id}`);
    for (const slop of [jar, leafy, maze]) await expect(shown(slop)).toBeVisible();
    await expect(shown(held)).toHaveCount(0);
    const games = page.getByRole("group", { name: "Categories" }).getByRole("checkbox", { name: "Games" });
    await games.locator("xpath=ancestor::label[1]").click();
    await expect(page).toHaveURL(`/wall?q=${id}&category=games`);
    await expect(shown(maze)).toBeVisible();
    await expect(shown(jar)).toHaveCount(0);
    await expect(box).toHaveValue(id);

    await page.goBack();
    await expect(page).toHaveURL(`/wall?q=${id}`);
    await expect(shown(jar)).toBeVisible();

    // One word that starts no other: search splits on hyphens, and this test's id would match its own slops.
    // Letters only, since digits split it into short words other slops' names share.
    const nothing = `zq${id.replace(/\d/g, (digit) => "abcdefghij"[Number(digit)])}`;
    await box.fill(nothing);
    await box.press("Enter");
    await expect(page.getByText(`No slop matches “${nothing}” yet.`)).toBeVisible();
  });

  test("the chips and the search box work without JavaScript", async ({ browser, seed, stack }) => {
    const maker = await seed.user("nojs");
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const jar = await seed.slop(maker, { name: `Penny Jar ${id}`, category: "money" });
    const maze = await seed.slop(maker, { name: `Marble Maze ${id}`, category: "games" });
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: stack.appUrl });
    const page = await context.newPage();

    await page.goto("/wall");
    await page.getByRole("searchbox", { name: "Search slops" }).fill(id);
    await page.getByRole("group", { name: "Categories" }).getByRole("checkbox", { name: "Money" }).check();
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(`/wall?q=${id}&category=money`);
    await expect(page.getByRole("link", { name: jar.name, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: maze.name, exact: true })).toHaveCount(0);
    await context.close();
  });

  test("a goal shows day by day on its maker's profile, with a streak and the streaks board", async ({
    seed,
    convex,
  }) => {
    const maker = await seed.user("streaker");
    const now = today();
    const start = addDays(now, -2);
    await convex.mutation(api.goals.create, {
      userId: maker.id,
      title: "7 slops in 7 days",
      target: 7,
      days: 7,
      startDate: start,
      today: now,
    });
    const id = Date.now().toString(36);
    const slops = [];
    for (const offset of [-2, -1, 0]) {
      slops.push(await launchOn(convex, maker, `Streak ${id} day ${offset + 3}`, addDays(now, offset)));
    }

    const page = await seed.visitorPage();
    await page.goto(`/@${maker.username}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Streaker");
    const grid = page.getByRole("region", { name: "7 slops in 7 days: 3 of 7 slopped" });
    await expect(grid).toBeVisible();
    await expect(grid).toContainText(`@${maker.username} · Slopping · Day 3 of 7`);
    await expect(grid).toContainText("3-day streak");
    await expect(grid.getByLabel(`Day 4, ${formatDay(addDays(now, 1))}: upcoming`)).toBeVisible();
    for (const [index, slop] of slops.entries()) {
      await expect(page.getByRole("link", { name: slop.name, exact: true })).toBeVisible();
      await expect(
        grid.getByRole("link", { name: `Day ${index + 1}, ${formatDay(addDays(start, index))}: slopped ${slop.name}` }),
      ).toHaveAttribute("href", slop.path);
    }
    const streak = await page
      .locator("dt", { hasText: "Streak" })
      .evaluate((term) => term.nextElementSibling?.textContent);
    expect(streak?.trim()).toBe("3");

    // A shipped day goes to what was shipped.
    await grid.getByRole("link", { name: new RegExp(`^Day 1, .*: slopped ${slops[0].name}$`) }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(slops[0].name);

    await page.goto("/streaks");
    const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: `@${maker.username}` }) });
    await expect(row).toContainText("3/7");
    await expect(row).toContainText("3-day streak");

    // Signed in, home is about their goal.
    const own = await seed.pageAs(maker);
    await own.goto("/");
    await expect(own.getByRole("heading", { level: 1 })).toHaveText("Keep slopping.");
    await expect(own.getByRole("link", { name: "Throw today's slop" })).toBeVisible();
  });
});
