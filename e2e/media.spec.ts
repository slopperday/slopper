import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { bucketObjects, checkRequests, expect, test } from "./fixtures.ts";

/** The new-slop form, filled in except for screenshots. */
async function fillLaunch(page: Page, name: string): Promise<void> {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Tagline").fill("Screenshots for the e2e tests");
  await page.getByLabel("Link 1 address").fill("https://example.com/");
  await page.getByLabel("Category").selectOption("utilities");
}

test.describe("screenshots", () => {
  test("a blocked image is refused and never stored; a clean one goes to the bucket and away with its slop", async ({
    seed,
    stack,
  }) => {
    const id = Date.now().toString(36);
    const page = await seed.pageAs(await seed.user("snapper"));
    await page.goto("/new");
    const files = page.locator('input[type="file"]');

    // Refused before it's stored: the check saw the image, the bucket never did.
    const blockedName = `nope-${id} [e2e:blocked].png`;
    const blocked = await page.screenshot({ clip: { x: 0, y: 0, width: 480, height: 320 } });
    await files.setInputFiles({ name: blockedName, mimeType: "image/png", buffer: blocked });
    await expect(page.getByRole("alert")).toHaveText("This image can't go on Slopper.");
    await expect(page.getByRole("img", { name: "Screenshot 1" })).toHaveCount(0);
    const refused = (await checkRequests(stack)).find((request) => request.text.includes(blockedName));
    expect(refused).toMatchObject({ images: 1, verdict: "blocked" });
    expect((await bucketObjects(stack)).map((object) => object.sha256)).not.toContain(refused?.imageHashes[0]);

    // A clean one is stored in the bucket under a fresh key, with a public URL.
    const name = `Snapper ${id}`;
    await fillLaunch(page, name);
    const shotName = `shot-${id}.png`;
    await files.setInputFiles({ name: shotName, mimeType: "image/png", buffer: await page.screenshot() });
    const thumbnail = page.getByRole("img", { name: "Screenshot 1" });
    await expect(thumbnail).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    const checked = (await checkRequests(stack)).find((request) => request.text.includes(shotName));
    expect(checked).toMatchObject({ images: 1, verdict: "ok" });
    const stored = (await bucketObjects(stack)).find((object) => object.sha256 === checked?.imageHashes[0]);
    // A PNG screenshot stays a lossless PNG, so its text stays crisp.
    expect(stored).toMatchObject({ contentType: "image/png", cacheControl: "public, max-age=31536000, immutable" });
    expect(stored?.key).toMatch(/^screenshots\/[\w-]+\.png$/);
    const url = `${stack.mediaUrl}/${stored?.key}`;
    await expect(thumbnail).toHaveAttribute("src", url);

    // It launches with the slop, and the bucket serves the same bytes.
    await page.getByRole("button", { name: "Throw it at the wall" }).click();
    await expect(page.getByRole("status")).toHaveText(`${name} is on the wall.`);
    await expect(page.getByRole("img", { name: `${name} screenshot 1` })).toHaveAttribute("src", url);
    const served = await fetch(url);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(
      createHash("sha256")
        .update(new Uint8Array(await served.arrayBuffer()))
        .digest("hex"),
    ).toBe(stored?.sha256);

    // Deleting the slop deletes the object.
    const path = new URL(page.url()).pathname;
    await page.goto(`${path}/edit`);
    await page.getByLabel("Type the slug to confirm").fill(path.split("/").at(-1) ?? "");
    await page.getByRole("button", { name: "Delete forever" }).click();
    await expect(page.getByRole("status")).toHaveText(`${name} was scraped off the wall.`);
    expect((await bucketObjects(stack)).map((object) => object.key)).not.toContain(stored?.key);
  });

  test("a mature image is stored, and the slop that shows it is blurred", async ({ seed, stack }) => {
    const id = Date.now().toString(36);
    const page = await seed.pageAs(await seed.user("moody"));
    await page.goto("/new");
    const name = `Moody ${id}`;
    await fillLaunch(page, name);

    const fileName = `gore-${id} [e2e:mature].png`;
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: fileName, mimeType: "image/png", buffer: await page.screenshot() });
    await expect(page.getByRole("img", { name: "Screenshot 1" })).toBeVisible();
    await expect(page.getByText("That one looks NSFW, so this slop will be blurred.")).toBeVisible();
    expect((await checkRequests(stack)).find((request) => request.text.includes(fileName))).toMatchObject({
      images: 1,
      verdict: "mature",
    });

    // The launch text is clean, but the screenshot still blurs it.
    await page.getByRole("button", { name: "Throw it at the wall" }).click();
    await expect(page.getByRole("status")).toHaveText(`${name} is on the wall. It's marked NSFW, so it's blurred.`);
    await expect(page.getByText("NSFW", { exact: true }).first()).toBeVisible();
    const visitor = await seed.visitorPage();
    await visitor.goto("/today");
    await expect(visitor.getByRole("link", { name, exact: true })).toHaveCount(0);
  });
});
