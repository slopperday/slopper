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

  test("feedback and kudos land on the page for everyone", async ({ seed }) => {
    const maker = await seed.user("maker");
    const fan = await seed.user("fan");
    const slop = await seed.slop(maker);

    const makerPage = await seed.pageAs(maker);
    await makerPage.goto(slop.path);
    const fanPage = await seed.pageAs(fan);
    await fanPage.goto(slop.path);

    await fanPage.getByLabel("Your feedback").fill("The **tilt** is too sensitive on Android.");
    await fanPage.getByRole("button", { name: "Leave feedback" }).click();
    await expect(fanPage.getByRole("status")).toHaveText("Feedback posted.");
    await fanPage.getByLabel("Your feedback").fill("Played it for an hour.");
    await fanPage.getByRole("button", { name: "🔥 This is good" }).click();
    await expect(fanPage.getByRole("status")).toHaveText("Kudos sent. 🔥");

    const feedback = makerPage.locator("#feedback");
    await expect(feedback.getByText("is too sensitive on Android.")).toBeVisible();
    await expect(feedback.locator("strong", { hasText: "tilt" })).toBeVisible();
    await expect(feedback.getByText("Played it for an hour.")).toBeVisible();
    await expect(makerPage.getByRole("link", { name: "Notifications, 2 unread" })).toBeVisible();

    // The author can take theirs back.
    await fanPage
      .locator("#feedback li", { hasText: "Played it for an hour." })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(feedback.getByText("Played it for an hour.")).toHaveCount(0);
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

test.describe("slop of the day", () => {
  test("the day's top slop is crowned, and its maker hears about it", async ({ seed, stack }) => {
    const maker = await seed.user("champ");
    const slop = await seed.slop(maker, { name: `Champion ${Date.now().toString(36)}` });
    // Far more votes than any other test gives its slops.
    for (let index = 0; index < 12; index++) await seed.vote(await seed.user("voter"), slop, 1);

    runInternal(stack, "race:crown", { date: new Date().toISOString().slice(0, 10) });

    const page = await seed.pageAs(maker);
    await page.goto(slop.path);
    await expect(page.getByText(/Slop of the day/).first()).toBeVisible();
    await page.goto("/notifications");
    await expect(page.getByText(`🏆 ${slop.name} won slop of the day`)).toBeVisible();
    await page.goto("/");
    await expect(page.locator("section", { hasText: "Latest winner" }).getByText(slop.name).first()).toBeVisible();
  });
});
