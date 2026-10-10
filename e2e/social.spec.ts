import { api } from "../convex/_generated/api.js";
import { expect, runInternal, test } from "./fixtures.ts";

test.describe("people reacting, live", () => {
  test("an upvote reaches the maker's open page and bell without a reload", async ({ seed }) => {
    const maker = await seed.user("maker");
    const fan = await seed.user("fan");
    const slop = await seed.slop(maker);

    const makerPage = await seed.pageAs(maker);
    await makerPage.goto(slop.path);
    // The maker can't vote on their own slop.
    await expect(makerPage.getByRole("button", { name: "Upvote" })).toBeDisabled();
    const makerCount = makerPage.locator("header").getByRole("button", { name: "Upvote" }).locator("xpath=..");
    await expect(makerCount).toContainText("0");
    await expect(makerPage.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();

    const fanPage = await seed.pageAs(fan);
    await fanPage.goto(slop.path);
    const upvote = fanPage.locator("header").getByRole("button", { name: "Upvote" });
    await upvote.click();
    await expect(upvote).toHaveAttribute("aria-pressed", "true");

    // Live: no reload on the maker's side.
    await expect(makerCount).toContainText("1");
    await expect(makerPage.getByRole("link", { name: "Notifications, 1 unread" })).toBeVisible();

    await makerPage.getByRole("link", { name: "Notifications, 1 unread" }).click();
    await expect(makerPage.getByText(`@${fan.username} upvoted ${slop.name}`)).toBeVisible();
    // Seeing them is reading them.
    await expect(makerPage.getByRole("link", { name: "Notifications", exact: true })).toBeVisible();
  });

  test("downvotes stay private", async ({ seed }) => {
    const maker = await seed.user("maker");
    const critic = await seed.user("critic");
    const slop = await seed.slop(maker);
    await seed.vote(await seed.user("fan"), slop, 1);

    const page = await seed.pageAs(critic);
    await page.goto(slop.path);
    const votes = page.locator('form[action$="/vote"]');
    await expect(votes).toContainText("1");
    await votes.getByRole("button", { name: "Downvote (private)" }).click();
    await expect(votes.getByRole("button", { name: "Downvote (private)" })).toHaveAttribute("aria-pressed", "true");
    // Only upvotes are ever shown.
    await expect(votes).toContainText("1");
    await page.reload();
    await expect(page.locator('form[action$="/vote"]')).toContainText("1");
  });

  test("comments are off: no feedback, no counts, and nothing that writes them", async ({ seed, convex }) => {
    const maker = await seed.user("maker");
    const fan = await seed.user("fan");
    const slop = await seed.slop(maker);
    // Feedback posted before comments went off stays stored, and unseen.
    await convex.mutation(api.activity.addComment, {
      userId: fan.id,
      slopId: slop.id,
      kind: "feedback",
      body: "Stored, never shown.",
    });

    const page = await seed.pageAs(fan);
    await page.goto(slop.path);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(slop.name);
    await expect(page.getByRole("heading", { name: "Updates" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Feedback", exact: true })).toHaveCount(0);
    await expect(page.locator("#feedback")).toHaveCount(0);
    await expect(page.getByLabel("Your feedback")).toHaveCount(0);
    await expect(page.getByText("Stored, never shown.")).toHaveCount(0);

    for (const path of ["/today", `/@${maker.username}`]) {
      await page.goto(path);
      const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: slop.name, exact: true }) });
      await expect(row).toBeVisible();
      await expect(row).not.toContainText("feedback");
    }

    const writes: Record<string, string>[] = [
      { intent: "comment", kind: "feedback", body: "Let me in." },
      { intent: "delete-comment", id: "anything" },
    ];
    for (const form of writes) {
      const response = await page.request.post(slop.path, { form, maxRedirects: 0 });
      expect(response.status()).toBe(404);
    }
    expect((await convex.query(api.slops.getForServer, { slopId: slop.id }))?.commentCount).toBe(1);
  });

  test("visitors are asked to sign in before voting or pledging", async ({ seed }) => {
    const slop = await seed.slop(await seed.user("maker"));
    const page = await seed.visitorPage();
    await page.goto(slop.path);
    await page.getByRole("link", { name: "💸 Take my money" }).click();
    await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent(slop.path)}`);
  });

  test("a pledge shows the maker what people would pay", async ({ seed }) => {
    const maker = await seed.user("maker");
    const backer = await seed.user("backer");
    const slop = await seed.slop(maker);

    const makerPage = await seed.pageAs(maker);
    await makerPage.goto(slop.path);
    await expect(makerPage.getByText("pledged by 0 people")).toBeVisible();

    const page = await seed.pageAs(backer);
    await page.goto(slop.path);
    await page.getByRole("button", { name: "💸 Take my money" }).click();
    await page.getByRole("button", { name: "$10" }).click();
    await expect(page.getByText("You pledged $10.")).toBeVisible();

    await expect(makerPage.getByText("pledged by 1 person")).toBeVisible();
    await expect(makerPage.getByText("$10").first()).toBeVisible();

    await page.getByRole("button", { name: "Change" }).click();
    await page.getByRole("button", { name: "Withdraw my pledge" }).click();
    await expect(makerPage.getByText("pledged by 0 people")).toBeVisible();
  });
});

test.describe("votes", () => {
  test("everyone gets five a day, and taking one back frees it", async ({ seed }) => {
    const maker = await seed.user("prolific");
    const slops = [];
    for (let index = 0; index < 6; index++) {
      slops.push(await seed.slop(maker, { name: `Ballot ${index} ${Date.now().toString(36)}` }));
    }
    const fan = await seed.user("picky");
    for (const slop of slops.slice(0, 5)) await seed.vote(fan, slop, 1);
    const page = await seed.pageAs(fan);

    await page.goto(slops[5].path);
    const upvote = page.locator("header").getByRole("button", { name: "Upvote" });
    await upvote.click();
    await expect(page.getByRole("alert")).toHaveText("You've used your 5 votes for today. More at midnight UTC.");
    await expect(upvote).toHaveAttribute("aria-pressed", "false");
    await page.goto("/today");
    await expect(page.getByText("You've cast all 5 of today's votes.", { exact: false })).toBeVisible();

    await page.goto(slops[0].path);
    await page.locator("header").getByRole("button", { name: "Upvote" }).click();
    await expect(page.locator("header").getByRole("button", { name: "Upvote" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await page.goto("/today");
    await expect(page.getByText("1 vote left today, out of 5.", { exact: false })).toBeVisible();
  });
});

test.describe("slop of the day", () => {
  test("the day's top slop is crowned and goes slopcessful, and its maker hears about it", async ({ seed, stack }) => {
    const maker = await seed.user("champ");
    const slop = await seed.slop(maker, { name: `Champion ${Date.now().toString(36)}` });
    // Far more votes than any other test gives its slops.
    for (let index = 0; index < 12; index++) await seed.vote(await seed.user("voter"), slop, 1);

    runInternal(stack, "race:crown", { date: new Date().toISOString().slice(0, 10) });

    const page = await seed.pageAs(maker);
    await page.goto(slop.path);
    await expect(page.getByText(/Slop of the day/).first()).toBeVisible();
    await expect(page.getByText(/★ Slopcessful: Won slop of the day on .+ with 12 upvotes\./)).toBeVisible();
    await page.goto("/slopcessful");
    await expect(page.getByRole("link", { name: slop.name }).first()).toBeVisible();
    await page.goto("/notifications");
    await expect(page.getByText(`🏆 ${slop.name} won slop of the day`)).toBeVisible();
    await page.goto("/");
    await expect(page.locator("section", { hasText: "Latest winner" }).getByText(slop.name).first()).toBeVisible();
  });
});
