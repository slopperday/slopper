import { expect, test, choose } from "./fixtures.ts";

test.describe("reviews", () => {
  test("someone who tried it reviews it with a screenshot, and it's up at once", async ({ seed }) => {
    const maker = await seed.user("reviewed");
    const slop = await seed.slop(maker);
    const tester = await seed.user("reviewer");
    const page = await seed.pageAs(tester);
    await page.goto(`${slop.path}#reviews`);

    await choose(page, "Broken for me");
    await page.getByRole("textbox", { name: "Review", exact: true }).fill("Crashes when I tilt left.");
    await page
      .locator('#reviews input[type="file"]')
      .setInputFiles({ name: "crash.png", mimeType: "image/png", buffer: await page.screenshot() });
    await expect(page.getByRole("img", { name: "Screenshot 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(page.getByRole("status")).toHaveText("Review posted. Thanks for trying it.");
    // The form now edits their review.
    await expect(page.getByRole("button", { name: "Update review" })).toBeVisible();

    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    const review = visitor.locator("#reviews li").filter({ hasText: "Crashes when I tilt left." });
    await expect(review).toContainText("Broken for me");
    await expect(review).toContainText(`@${tester.username}`);
    await expect(review.getByRole("img", { name: `${slop.name} update image 1` })).toHaveAttribute(
      "src",
      /screenshots\/.+\.png$/,
    );

    // The maker reads it but can't review their own slop or delete the review.
    const makerPage = await seed.pageAs(maker);
    await makerPage.goto(slop.path);
    await expect(makerPage.locator("#reviews li").filter({ hasText: "Crashes when I tilt left." })).toBeVisible();
    await expect(makerPage.getByRole("button", { name: "Post review" })).toHaveCount(0);
    await expect(makerPage.locator("#reviews").getByRole("button", { name: "Delete" })).toHaveCount(0);
  });

  test("an offensive review is refused and never shows", async ({ seed }) => {
    const maker = await seed.user("refusedfor");
    const slop = await seed.slop(maker);
    const page = await seed.pageAs(await seed.user("rude"));
    await page.goto(`${slop.path}#reviews`);

    await choose(page, "Mixed");
    await page.getByRole("textbox", { name: "Review", exact: true }).fill("Not fit to print [e2e:blocked]");
    await page.getByRole("button", { name: "Post review" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "This review can't go on Slopper. Keep it about the app, and keep it civil.",
    );
    await expect(page.locator("#reviews li").filter({ hasText: "Not fit to print" })).toHaveCount(0);
  });
});
