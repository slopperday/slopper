import { api } from "../convex/_generated/api.js";
import { choose, expect, test } from "./fixtures.ts";

test.describe("updates", () => {
  test("an address that spent its preview budget can still post plain links", async ({ seed, convex }) => {
    const maker = await seed.user("previewquota");
    const slop = await seed.slop(maker);
    const address = `preview-${maker.id}`;

    for (let i = 0; i < 60; i++) {
      expect(
        await convex.mutation(api.limits.hit, {
          key: `update-preview:${address}`,
          limit: 60,
          windowMs: 3_600_000,
        }),
      ).toBe(true);
    }

    const page = await seed.pageAs(maker);
    await page.setExtraHTTPHeaders({ "x-nf-client-connection-ip": address });
    await page.goto(slop.path);
    await page.getByRole("textbox", { name: "Update", exact: true }).fill("Release notes.");
    await page.getByText("Version, images and links").click();
    await page.getByRole("button", { name: "Add a link" }).click();
    await page.getByLabel("Link 1 address").fill("https://example.com/notes");
    await page.getByLabel("Show a preview card").check();
    await page.getByRole("button", { name: "Post update" }).click();
    await expect(page.getByRole("alert")).toHaveText("Too many link previews. Try again later.");
    await expect(page.locator("#updates li").filter({ hasText: "Release notes." })).toHaveCount(0);

    await page.getByLabel("Show a preview card").uncheck();
    await page.getByRole("button", { name: "Post update" }).click();
    await expect(page.getByRole("status")).toHaveText("Update posted.");
    await expect(page.locator("#updates li").filter({ hasText: "Release notes." })).toHaveCount(1);
  });

  test("a maker ships a named feature with its version, an image and a link", async ({ seed }) => {
    const maker = await seed.user("shipper");
    const slop = await seed.slop(maker);
    const page = await seed.pageAs(maker);
    await page.goto(slop.path);

    await choose(page, "New feature");
    await page.getByLabel("Feature name").fill("Level editor");
    await page.getByRole("textbox", { name: "Update", exact: true }).fill("Build a maze and share the link.");
    await page.getByText("Version, images and links").click();
    await page.getByLabel("Version").fill("v1.3");
    await page
      .locator('#updates input[type="file"]')
      .setInputFiles({ name: "editor.png", mimeType: "image/png", buffer: await page.screenshot() });
    await expect(page.getByRole("img", { name: "Image 1", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add a link" }).click();
    await page.getByLabel("Link 1 address").fill("https://example.com/editor");
    // Previews are off until asked for.
    await expect(page.getByLabel("Show a preview card")).not.toBeChecked();
    await page.getByRole("button", { name: "Post update" }).click();
    await expect(page.getByRole("status")).toHaveText("New feature posted.");

    // The composer is empty again, ready for the next one.
    await expect(page.getByRole("textbox", { name: "Update", exact: true })).toHaveValue("");
    await expect(page.getByRole("img", { name: "Image 1", exact: true })).toHaveCount(0);

    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    const update = visitor.locator("#updates li").filter({ hasText: "Level editor" });
    await expect(update).toContainText("New feature");
    await expect(update).toContainText("v1.3");
    await expect(update).toContainText("Build a maze and share the link.");
    await expect(update.getByRole("img", { name: `${slop.name} update image 1` })).toHaveAttribute(
      "src",
      /screenshots\/.+\.png$/,
    );
    await expect(update.getByRole("link", { name: /Website\s*example\.com/ })).toHaveAttribute(
      "href",
      "https://example.com/editor",
    );
    await expect(update.getByRole("button", { name: "Remove preview" })).toHaveCount(0);
    const here = visitor.url();
    await update.getByRole("img", { name: `${slop.name} update image 1` }).click();
    const dialog = visitor.getByRole("dialog", { name: `${slop.name} update image 1` });
    await expect(dialog.getByRole("img")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Next" })).toHaveCount(0);
    expect(visitor.url()).toBe(here);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("a field test says how it went and who tried it", async ({ seed }) => {
    const maker = await seed.user("fielder");
    const slop = await seed.slop(maker);
    const page = await seed.pageAs(maker);
    await page.goto(`${slop.path}?kind=field#updates`);

    await choose(page, "Mixed");
    await page.getByLabel("Who tried it").fill("5 people at the bus stop");
    await page.getByRole("textbox", { name: "Update", exact: true }).fill("Three got hooked, two got lost.");
    await page.getByRole("button", { name: "Post update" }).click();
    await expect(page.getByRole("status")).toHaveText("Field test posted.");
    const update = page.locator("#updates li").filter({ hasText: "Three got hooked" });
    await expect(update).toContainText("Mixed");
    await expect(update).toContainText("Tried by 5 people at the bus stop");
  });

  test("the maker can take a preview card off, and the link stays", async ({ seed, convex }) => {
    const maker = await seed.user("carder");
    const slop = await seed.slop(maker);
    const reservationId = await convex.mutation(api.activity.reserveUpdate, { userId: maker.id, slopId: slop.id });
    await convex.mutation(api.activity.addUpdate, {
      reservationId,
      userId: maker.id,
      slopId: slop.id,
      kind: "update",
      body: "Release notes are up.",
      links: [
        {
          kind: "other",
          url: "https://example.com/notes",
          preview: { title: "What's new in 1.3", description: "Mazes!", siteName: "Example", imageId: null },
        },
      ],
    });

    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    await expect(visitor.getByRole("link", { name: /What's new in 1\.3/ })).toHaveAttribute(
      "href",
      "https://example.com/notes",
    );
    await expect(visitor.getByRole("button", { name: "Remove preview" })).toHaveCount(0);

    const page = await seed.pageAs(maker);
    await page.goto(slop.path);
    await page.getByRole("button", { name: "Remove preview" }).click();
    await expect(page.getByRole("status")).toHaveText("Preview removed.");
    await expect(page.getByText("What's new in 1.3")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Other link\s*example\.com/ })).toHaveAttribute(
      "href",
      "https://example.com/notes",
    );
  });

  test("an agent posts the same metadata, and a preview never reaches a private address", async ({
    seed,
    stack,
    request,
  }) => {
    const maker = await seed.user("agentic");
    const slop = await seed.slop(maker);
    const auth = { authorization: `Bearer ${await seed.apiToken(maker)}` };

    const wrong = await request.post(`${stack.appUrl}/api/v1/slops/${slop.slug}/updates`, {
      headers: auth,
      data: { kind: "update", body: "Hi", featureName: "Level editor" },
    });
    expect(wrong.status()).toBe(422);
    expect(await wrong.json()).toMatchObject({
      details: { featureName: "A feature name is for feature updates." },
    });

    const posted = await request.post(`${stack.appUrl}/api/v1/slops/${slop.slug}/updates`, {
      headers: auth,
      data: {
        kind: "field",
        body: "It held up.",
        version: "v2.0",
        outcome: "worked",
        // The app itself, on this machine: the card is never read.
        links: [{ url: `${stack.appUrl}/`, preview: true }],
      },
    });
    expect(posted.status()).toBe(201);
    expect(await posted.json()).toMatchObject({ update: { kind: "field", missedPreviews: 1 } });

    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    const update = visitor.locator("#updates li").filter({ hasText: "It held up." });
    await expect(update).toContainText("v2.0");
    await expect(update).toContainText("Worked");
    await expect(update.getByRole("link", { name: /Website/ })).toHaveAttribute("href", `${stack.appUrl}/`);
  });
});
