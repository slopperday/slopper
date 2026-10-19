import { api } from "../convex/_generated/api.js";
import { addDays } from "../app/lib/dates.ts";
import { checkRequests, choose, expect, test } from "./fixtures.ts";

const today = () => new Date().toISOString().slice(0, 10);

test.describe("scheduled launches", () => {
  test("lines launches up from the form, shows them coming, and throws one now", async ({ seed, stack, convex }) => {
    const maker = await seed.user("maker");
    await convex.mutation(api.goals.create, {
      userId: maker.id,
      title: "10 slops in 10 days",
      target: 10,
      days: 10,
      startDate: today(),
      today: today(),
    });
    const page = await seed.pageAs(maker);
    const suffix = Date.now().toString(36);
    const first = `Marbles ${suffix}`;
    const second = `Kites ${suffix}`;

    async function fill(name: string) {
      await page.getByLabel("Name").fill(name);
      await page.getByLabel("Tagline").fill("Ready, but not today");
      await page.getByLabel("Link 1 address").fill("https://example.com/");
      await page.getByLabel("Category").selectOption("games");
    }

    // The next free day: nothing is out tomorrow yet.
    await page.goto("/new");
    await fill(first);
    await choose(page, /Next free day/);
    await page.getByRole("button", { name: "Schedule it" }).click();
    await expect(page).toHaveURL("/new");
    await expect(page.getByRole("status")).toContainText(`${first} goes out`);

    // A picked time, two days out at 9am (the maker's zone is UTC).
    await fill(second);
    await choose(page, /Pick a time/);
    await page.getByLabel("Day and time").fill(`${addDays(today(), 2)}T09:00`);
    await page.getByRole("button", { name: "Schedule it" }).click();
    await expect(page.getByRole("status")).toContainText(`${second} goes out`);

    const scheduled = page.getByRole("region", { name: "Scheduled" });
    await expect(scheduled.getByText(first)).toBeVisible();
    await expect(scheduled.getByText(second)).toBeVisible();

    // Everyone sees that something's coming on the goal, but not what.
    const visitor = await seed.visitorPage();
    await visitor.goto(`/@${maker.username}`);
    await expect(visitor.getByLabel(/: upcoming, 1 scheduled$/)).toHaveCount(2);
    await expect(visitor.getByText(first)).toHaveCount(0);
    await visitor.goto("/wall");
    await expect(visitor.getByText(first)).toHaveCount(0);

    // Throw the first now: it's checked, on the wall and counts today.
    await scheduled.getByRole("button", { name: `Throw it now: ${first}` }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(first);
    await expect(page.getByRole("status")).toHaveText(`${first} is on the wall.`);
    await expect(page.getByText("Day 1/10 · Launched")).toBeVisible();
    expect((await checkRequests(stack)).some((request) => request.text.includes(first))).toBe(true);

    // Drop the second.
    await page.goto("/new");
    await page.getByRole("button", { name: `Unschedule: ${second}` }).click();
    await expect(page.getByRole("status")).toHaveText(`${second} is off the schedule.`);
    await expect(page.getByRole("region", { name: "Scheduled" })).toHaveCount(0);
  });

  test("says what's wrong with a picked time", async ({ seed }) => {
    const maker = await seed.user("maker");
    const page = await seed.pageAs(maker);
    await page.goto("/new");
    await page.getByLabel("Name").fill(`Late ${Date.now().toString(36)}`);
    await page.getByLabel("Tagline").fill("Too late");
    await page.getByLabel("Link 1 address").fill("https://example.com/");
    await page.getByLabel("Category").selectOption("games");
    await choose(page, /Pick a time/);
    await page.getByLabel("Day and time").fill(`${addDays(today(), -1)}T09:00`);
    await page.getByRole("button", { name: "Schedule it" }).click();
    await expect(page.getByText("Pick a time that hasn't happened yet.")).toBeVisible();
  });

  test("goes out by itself, and the app server checks it", async ({ seed, stack, convex, request }) => {
    // Convex's scheduler and its call to the app server run on their own time, slower when the suite is busy.
    test.setTimeout(90_000);
    const maker = await seed.user("maker");
    const name = `Clockwork ${Date.now().toString(36)}`;
    await convex.mutation(api.schedule.add, {
      userId: maker.id,
      input: {
        name,
        tagline: "Out on its own",
        description: "",
        category: "games",
        links: [{ kind: "website", url: "https://example.com/" }],
        screenshots: [],
        madeWith: [],
      },
      launchNote: "Out on its own",
      when: { kind: "at", at: Date.now() + 2_000 },
      autopost: false,
    });

    // Convex puts it out, then the app server claims it and runs the content check.
    await expect
      .poll(async () => (await checkRequests(stack)).some((check) => check.text.includes(name)), { timeout: 60_000 })
      .toBe(true);
    await expect.poll(() => convex.query(api.schedule.mine, { asUser: maker.id })).toEqual([]);
    // The verdict is saved once the check answers, a moment after it was asked.
    await expect
      .poll(async () => (await convex.query(api.slops.listForServer, { userId: maker.id }))[0], { timeout: 20_000 })
      .toMatchObject({ name, launchDate: today(), check: { verdict: "ok" } });
    const [slop] = await convex.query(api.slops.listForServer, { userId: maker.id });

    // Nothing left to claim, so the hook has nothing to do.
    expect((await request.post(`${stack.appUrl}/api/scheduled/${slop._id}`)).status()).toBe(404);
  });

  test("agents schedule, list, release and drop launches over REST", async ({ seed, request }) => {
    const maker = await seed.user("agent");
    const headers = { authorization: `Bearer ${await seed.apiToken(maker)}` };
    const launch = (name: string, releaseAt: string) =>
      request.post("/api/v1/slops", {
        headers,
        data: {
          name,
          tagline: "Queued by an agent",
          category: "ai",
          links: [{ kind: "website", url: "https://example.com/" }],
          releaseAt,
        },
      });

    const next = await launch("Agent one", "next");
    expect(next.status()).toBe(201);
    const { scheduled } = (await next.json()) as { scheduled: { id: string; releaseAt: string; out: null } };
    expect(scheduled).toMatchObject({ out: null });
    expect(Date.parse(scheduled.releaseAt)).toBeGreaterThan(Date.now());
    const later = (await (await launch("Agent two", `${addDays(today(), 3)}T12:00`)).json()) as {
      scheduled: { id: string; releaseAt: string };
    };
    expect(later.scheduled.releaseAt).toBe(`${addDays(today(), 3)}T12:00:00.000Z`);
    expect((await launch("Agent three", "whenever")).status()).toBe(422);

    const listed = (await (await request.get("/api/v1/scheduled", { headers })).json()) as {
      scheduled: { name: string }[];
    };
    expect(listed.scheduled.map((item) => item.name)).toEqual(["Agent one", "Agent two"]);

    const released = await request.post(`/api/v1/scheduled/${scheduled.id}/release`, { headers });
    expect(released.status()).toBe(201);
    expect(await released.json()).toMatchObject({
      slop: { name: "Agent one", launchDate: today(), hidden: false },
    });

    const dropped = await request.delete(`/api/v1/scheduled/${later.scheduled.id}`, { headers });
    expect(await dropped.json()).toEqual({ cancelled: "Agent two" });
    const again = await request.delete(`/api/v1/scheduled/${later.scheduled.id}`, { headers });
    expect(again.status()).toBe(409);
  });
});
