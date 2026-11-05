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

  test("comments are on: feedback posts at once, and a mature one waits for a moderator", async ({ seed }) => {
    const maker = await seed.user("maker");
    const fan = await seed.user("fan");
    const slop = await seed.slop(maker);

    const page = await seed.pageAs(fan);
    await page.goto(`${slop.path}#feedback`);
    await page.getByLabel("Your feedback").fill("The **tilt** is smooth.");
    await page.getByRole("button", { name: "Leave feedback" }).click();
    await expect(page.getByRole("status")).toHaveText("Feedback posted.");
    await expect(page.locator("#feedback")).toContainText("The tilt is smooth.");

    // The maker reads it, and the profile counts it.
    const makerPage = await seed.pageAs(maker);
    await makerPage.goto(slop.path);
    await expect(makerPage.locator("#feedback")).toContainText(`@${fan.username}`);
    await makerPage.goto(`/@${maker.username}`);
    const row = makerPage
      .getByRole("listitem")
      .filter({ has: makerPage.getByRole("link", { name: slop.name, exact: true }) });
    await expect(row).toContainText("1 feedback");

    // Blocked words are refused and never saved.
    const rudePage = await seed.pageAs(await seed.user("rude"));
    await rudePage.goto(`${slop.path}#feedback`);
    await rudePage.getByLabel("Your feedback").fill("Not fit to print [e2e:blocked]");
    await rudePage.getByRole("button", { name: "Leave feedback" }).click();
    await expect(rudePage.getByRole("alert")).toHaveText(
      "This comment can't go on Slopper. Keep it about the slop, and keep it civil.",
    );
    await expect(page.locator("#feedback")).not.toContainText("Not fit to print");

    // A mature comment waits hidden, then a moderator approves it and trusts its author.
    const spicy = await seed.user("spicy");
    const spicyPage = await seed.pageAs(spicy);
    await spicyPage.goto(`${slop.path}#feedback`);
    await spicyPage.getByLabel("Your feedback").fill("Too spicy [e2e:mature]");
    await spicyPage.getByRole("button", { name: "Leave feedback" }).click();
    await expect(spicyPage.getByRole("status")).toHaveText("Sent. A moderator will check it before it appears.");
    await expect(page.locator("#feedback")).not.toContainText("Too spicy");

    const modPage = await seed.pageAs(await seed.admin());
    await modPage.goto("/mod");
    const held = modPage.locator("article").filter({ hasText: "Too spicy" });
    await expect(held).toContainText("Held");
    await held.getByRole("button", { name: "Approve comment" }).click();
    await expect(modPage.getByRole("status")).toContainText(`@${spicy.username} is trusted now.`);
    await page.reload();
    await expect(page.locator("#feedback")).toContainText("Too spicy");

    // Trusted now: their next comment skips the check, even with a mature marker.
    await spicyPage.goto(`${slop.path}#feedback`);
    await spicyPage.getByLabel("Your feedback").fill("Still spicy [e2e:mature]");
    await spicyPage.getByRole("button", { name: "Leave feedback" }).click();
    await expect(spicyPage.getByRole("status")).toHaveText("Feedback posted.");
    await expect(page.locator("#feedback")).toContainText("Still spicy");
  });

  test("visitors are asked to sign in before voting", async ({ seed }) => {
    const slop = await seed.slop(await seed.user("maker"));
    const page = await seed.visitorPage();
    await page.goto(slop.path);
    await page.getByTitle("Sign in to vote").click();
    await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent(slop.path)}`);
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
    await expect(page.getByText("1 of 5 votes left today.")).toBeVisible();
  });
});

test.describe("slop of the day", () => {
  test("the day's top slop is crowned and goes slopcessful, and its maker hears about it", async ({ seed, stack }) => {
    const maker = await seed.user("champ");
    const slop = await seed.slop(maker, { name: `Champion ${Date.now().toString(36)}` });
    // Far more votes than any other test gives its slops.
    for (const voter of await seed.voters(12)) await seed.vote(voter, slop, 1);

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
