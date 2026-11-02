import { EDITING_CLOSED } from "../app/lib/editing.ts";
import { expect, test } from "./fixtures.ts";

test.describe("the edit window", () => {
  test("tells the maker how long a new launch stays editable", async ({ seed }) => {
    const maker = await seed.user("fresh");
    const slop = await seed.slop(maker);
    const page = await seed.pageAs(maker);
    await page.goto(slop.path);
    await expect(page.getByText(/^Editable until /)).toBeVisible();
    await page.getByRole("link", { name: "Edit details" }).click();
    await expect(page.getByText(/^Editable until .+, then it's locked/)).toBeVisible();
    await expect(page.getByLabel("Tagline")).toBeVisible();
  });

  test("locks the original post after the next day, while updates still post", async ({ seed, request }) => {
    const maker = await seed.user("late");
    const slop = await seed.pastSlop(maker, Date.now() - 2 * 86_400_000);
    const page = await seed.pageAs(maker);

    await page.goto(slop.path);
    await expect(page.getByText("Details locked.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit details" })).toHaveCount(0);

    // The edit page keeps auto-post and delete, but not the form.
    await page.goto(`${slop.path}/edit`);
    await expect(page.getByText("Locked.", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Tagline")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete forever" })).toBeVisible();

    await page.getByRole("link", { name: "Post an update" }).click();
    await expect(page).toHaveURL(`${slop.path}#updates`);
    await page.getByRole("textbox", { name: "Update" }).fill("Fixed the wall on level 3.");
    await page.getByRole("button", { name: "Post update" }).click();
    await expect(page.getByRole("status")).toHaveText("Update posted.");
    await expect(page.getByText("Fixed the wall on level 3.")).toBeVisible();

    // Agents get the same answer, in plain words.
    const headers = { authorization: `Bearer ${await seed.apiToken(maker)}` };
    const refused = await request.patch(`/api/v1/slops/${slop.slug}`, { headers, data: { tagline: "Too late" } });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ error: EDITING_CLOSED });
  });
});
