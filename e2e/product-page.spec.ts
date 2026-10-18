import { expect, test } from "./fixtures.ts";

test.describe("product page", () => {
  test("AI drafts the product page, the maker adds a video and saves it", async ({ seed }) => {
    const maker = await seed.user("producer");
    const slop = await seed.slop(maker, { name: "Marble Run", tagline: "A maze game" });
    const page = await seed.pageAs(maker);

    // A bare page nudges its owner towards the product page.
    await page.goto(slop.path);
    await page.getByRole("link", { name: "Fill in the product page" }).click();

    await page.getByRole("button", { name: "Draft the product page with AI" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Drafted." })).toBeVisible();
    await expect(page.getByLabel("Feature 1 title")).toHaveValue("Draw any maze");
    await expect(page.getByLabel("Who it's for")).toHaveValue("Anyone with a phone and five spare minutes");
    // Nothing is saved until the maker saves.
    await page.goto(slop.path);
    await expect(page.getByText("Draw any maze")).toHaveCount(0);

    await page.goto(`${slop.path}/edit`);
    await page.getByRole("button", { name: "Draft the product page with AI" }).click();
    await expect(page.getByLabel("Feature 2 title")).toHaveValue("Tilt to roll");
    await page.getByLabel("Demo video").fill("https://youtu.be/aqz-KE-bpKQ");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");

    await expect(page.getByRole("heading", { name: "What it does" })).toBeVisible();
    await expect(page.getByText("Tilt to roll")).toBeVisible();
    await expect(page.getByText("Anyone with a phone and five spare minutes")).toBeVisible();

    // The player only loads once someone presses play.
    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    await expect(visitor.locator("iframe")).toHaveCount(0);
    await visitor.getByRole("link", { name: "Play the Marble Run demo" }).click();
    await expect(visitor.locator("iframe")).toHaveAttribute(
      "src",
      /^https:\/\/www\.youtube-nocookie\.com\/embed\/aqz-KE-bpKQ\?/,
    );
  });

  test("a link that isn't a video is refused", async ({ seed }) => {
    const maker = await seed.user("videoless");
    const slop = await seed.slop(maker);
    const page = await seed.pageAs(maker);
    await page.goto(`${slop.path}/edit`);
    await page.getByText("Product page", { exact: true }).click();
    await page.getByLabel("Demo video").fill("https://example.com/video.mp4");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toHaveText("Link a video on YouTube, Loom or Vimeo.");
  });
});
