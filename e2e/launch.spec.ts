import { checkRequests, choose, expect, test } from "./fixtures.ts";

test.describe("a maker's day", () => {
  test("sets a goal, throws a slop with a screenshot, and it enters the race", async ({ seed, stack }) => {
    const maker = await seed.user("maker");
    const page = await seed.pageAs(maker);

    // A goal first, so the launch counts as day 1.
    await page.goto("/goal");
    // 30 days at one a day is where the form starts.
    await page.getByRole("button", { name: "Set the goal" }).click();
    await expect(page).toHaveURL("/goal");
    await expect(page.getByRole("status")).toHaveText("Goal set: 30 slops in 30 days.");

    // Any real image will do as a screenshot: use one of the page itself.
    const screenshot = await page.screenshot();
    const name = `TiltMaze ${Date.now().toString(36)}`;

    await page.goto("/new");
    await expect(page.getByText("30 slops in 30 days · Day 1 of 30")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Not safe for work/i })).toHaveCount(0);
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Tagline").fill("A marble maze you play by tilting your phone");
    await page.getByLabel("Link 1 address").fill("https://tiltmaze.example/");
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: screenshot });
    await expect(page.getByRole("img", { name: "Screenshot 1" })).toBeVisible();
    await page.getByLabel("Category").selectOption("games");
    // Made with: a comma turns what's typed into a tag, a suggestion is a click, and a full name picks itself.
    const madeWith = page.getByRole("combobox", { name: "Made with" });
    await madeWith.fill("Claude Code,");
    await page.getByRole("button", { name: "Add Opus 5.5" }).click();
    await madeWith.pressSequentially("vite");
    await expect(page.getByRole("button", { name: "Remove Vite" })).toBeVisible();
    await expect(madeWith).toHaveValue("");
    await page.getByLabel("Description").fill("Tilt to roll. **Sound on.**");
    await page.getByLabel("Launch note").fill("Day 1. Built on the bus.");
    await page.getByRole("button", { name: "Throw it at the wall" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
    await expect(page.getByRole("status")).toHaveText(`${name} is on the wall.`);
    await expect(page.getByText("It's on the wall. Now tell people:")).toBeVisible();
    await expect(page.getByText("Day 1/30 · Launched")).toBeVisible();
    await expect(page.getByRole("img", { name: `${name} screenshot 1` })).toBeVisible();
    await expect(page.locator(".prose-slop strong")).toHaveText("Sound on.");
    await expect(page.locator(".tag-kind-harness", { hasText: "Claude Code" })).toBeVisible();
    await expect(page.locator(".tag-kind-model", { hasText: "Opus 5.5" })).toBeVisible();

    // The content check saw the text and the screenshot.
    const checked = (await checkRequests(stack)).find((request) => request.text.includes(name));
    expect(checked).toMatchObject({ images: 1, verdict: "ok" });

    // Sharing links carry the slop's own URL.
    const share = page.getByRole("region", { name: "Share it" }).or(page.locator("section", { hasText: "Share it" }));
    const xHref = await share.getByRole("link", { name: "X" }).getAttribute("href");
    expect(decodeURIComponent(xHref ?? "")).toContain(`${stack.appUrl}/@${maker.username}/`);

    // It's in today's race and on the maker's page.
    await page.goto("/today");
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    await page.goto(`/@${maker.username}`);
    await expect(page.getByRole("link", { name, exact: true }).first()).toBeVisible();
  });

  test("posts updates, edits, launches again and logs money", async ({ seed }) => {
    const maker = await seed.user("maker");
    const slop = await seed.slop(maker, { name: `Marbles ${Date.now().toString(36)}` });
    const page = await seed.pageAs(maker);
    await page.goto(slop.path);

    // A field test.
    await choose(page, "Field test");
    await expect(page.getByText("Who tried it in real life")).toBeVisible();
    await page.getByRole("textbox", { name: "Update" }).fill("Showed it to 5 people at the bus stop. 3 got hooked.");
    await page.getByRole("button", { name: "Post update" }).click();
    await expect(page.getByRole("status")).toHaveText("Field test posted.");
    await expect(page.getByText("Showed it to 5 people at the bus stop.")).toBeVisible();

    // Edit the tagline.
    await page.getByRole("link", { name: "Edit details" }).click();
    await page.getByLabel("Tagline").fill("Now with a level editor");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
    await expect(page.getByText("Now with a level editor")).toBeVisible();

    // Money: a cost, made public.
    await page.getByText("Log a cost or revenue").click();
    await page.getByLabel("Amount").fill("12.99");
    await page.getByLabel("Category", { exact: true }).selectOption("domain");
    await page.getByLabel("Note").fill("Domain");
    await page.getByRole("button", { name: "Log it" }).click();
    await expect(page.getByRole("status")).toHaveText("Cost logged.");
    await expect(page.locator("#money li", { hasText: "Domain" })).toContainText("−$12.99");
    await page.getByRole("button", { name: "Make these numbers public" }).click();
    await expect(page.getByRole("status")).toHaveText("Your numbers are public now.");

    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    await expect(visitor.getByText("Building in public")).toBeVisible();
    await expect(visitor.getByText("$12.99").first()).toBeVisible();
    await expect(visitor.getByText("Domain")).toHaveCount(0);

    // Only winning the day makes a slop slopcessful; its maker can't declare it.
    await expect(page.getByRole("button", { name: /slopcessful/i })).toHaveCount(0);

    // Launch it again, on another platform.
    await page.getByRole("link", { name: "🚀 Launch again" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Launch ${slop.name} again`);
    await page.getByLabel("What's launching?").fill("iOS beta");
    await page.getByRole("button", { name: "Throw it at the wall" }).click();
    await expect(page.getByRole("status")).toHaveText(`${slop.name} · iOS beta is on the wall.`);
    await expect(page.getByText("🚀 iOS beta").first()).toBeVisible();
    const launches = page
      .getByRole("region", { name: "Launches" })
      .or(page.locator("section", { hasText: "Every launch of" }));
    await expect(launches.getByRole("link")).toHaveCount(2);
  });

  test("keeps the form and explains what to fix when a launch is incomplete", async ({ seed }) => {
    const page = await seed.pageAs(await seed.user("hasty"));
    await page.goto("/new");
    await page.getByLabel("Name").fill("Half done");
    await page.getByLabel("Tagline").fill("Missing a link");
    await page.getByLabel("Category").selectOption("games");
    await page.getByRole("button", { name: "Throw it at the wall" }).click();
    await expect(page.getByText("A couple of things need fixing.")).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue("Half done");
    await expect(page).toHaveURL("/new");
  });

  test("can delete a slop", async ({ seed }) => {
    const maker = await seed.user("tidy");
    const slop = await seed.slop(maker);
    const page = await seed.pageAs(maker);
    await page.goto(`${slop.path}/edit`);
    await page.getByLabel("Type the slug to confirm").fill(slop.slug);
    await page.getByRole("button", { name: "Delete forever" }).click();
    await expect(page.getByRole("status")).toHaveText(`${slop.name} was scraped off the wall.`);
    const response = await page.goto(slop.path);
    expect(response?.status()).toBe(404);
  });
});
