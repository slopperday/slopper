import { bucketObjects, expect, test } from "./fixtures.ts";

/** The smallest file that reads as an MP4: an `ftyp` box. */
const MP4 = Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, ...Buffer.from("isomiso2")]);

test.describe("promo videos", () => {
  test("an agent's video waits for a moderator, then plays for everyone", async ({ seed, stack, request }) => {
    const maker = await seed.user("promo");
    const slop = await seed.slop(maker);
    const auth = { authorization: `Bearer ${await seed.apiToken(maker)}` };

    const notVideo = await request.post(`${stack.appUrl}/api/v1/videos`, {
      headers: { ...auth, "content-type": "video/mp4" },
      data: Buffer.from("not a video"),
    });
    expect(notVideo.status()).toBe(400);
    expect(await notVideo.json()).toMatchObject({ error: "Use an MP4 or WebM video." });

    const uploaded = await request.post(`${stack.appUrl}/api/v1/videos`, {
      headers: { ...auth, "content-type": "video/mp4" },
      data: MP4,
    });
    expect(uploaded.status()).toBe(201);
    const { id } = (await uploaded.json()) as { id: string };
    const stored = (await bucketObjects(stack)).find((object) => object.key.startsWith("videos/"));
    expect(stored?.contentType).toBe("video/mp4");

    const set = await request.put(`${stack.appUrl}/api/v1/slops/${slop.slug}/video`, {
      headers: auth,
      data: { video: id },
    });
    expect(set.ok()).toBe(true);
    expect(await set.json()).toMatchObject({ slop: { id: slop.id, video: "pending" } });

    // The maker is told it's waiting; nobody else sees a thing yet.
    const own = await seed.pageAs(maker);
    await own.goto(slop.path);
    await expect(own.getByRole("status")).toContainText("Your video is waiting for a moderator.");
    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    await expect(visitor.getByRole("heading", { level: 1 })).toContainText(slop.name);
    await expect(visitor.locator("video")).toHaveCount(0);

    const moderator = await seed.pageAs(await seed.admin());
    await moderator.goto("/mod");
    const review = moderator.getByRole("article").filter({ hasText: slop.name });
    await expect(review.locator("video")).toHaveAttribute("src", /videos\/.+\.mp4$/);
    await review.getByRole("button", { name: "Approve video" }).click();
    await expect(moderator.getByRole("status")).toContainText(`${slop.name}: its video plays for everyone now.`);

    await visitor.goto(slop.path);
    await expect(visitor.getByRole("region", { name: "Promo video" }).locator("video")).toHaveAttribute(
      "src",
      /videos\/.+\.mp4$/,
    );
    await own.goto(slop.path);
    await expect(own.getByText("Your video is waiting for a moderator.")).toHaveCount(0);
  });

  test("a video can't be shown as a screenshot, and only its owner can set it", async ({ seed, stack, request }) => {
    const maker = await seed.user("sneaky");
    const slop = await seed.slop(maker);
    const auth = { authorization: `Bearer ${await seed.apiToken(maker)}` };
    const { id } = (await (
      await request.post(`${stack.appUrl}/api/v1/videos`, {
        headers: { ...auth, "content-type": "video/mp4" },
        data: MP4,
      })
    ).json()) as { id: string };

    // A video id among the screenshots is dropped, so nothing unreviewed reaches the page.
    const edited = await request.patch(`${stack.appUrl}/api/v1/slops/${slop.slug}`, {
      headers: auth,
      data: { screenshots: [id] },
    });
    expect(edited.ok()).toBe(true);
    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    await expect(visitor.getByRole("region", { name: "Screenshots" })).toHaveCount(0);

    const stranger = { authorization: `Bearer ${await seed.apiToken(await seed.user("stranger"))}` };
    const refused = await request.put(`${stack.appUrl}/api/v1/slops/${slop.id}/video`, {
      headers: stranger,
      data: { video: id },
    });
    expect(refused.status()).toBe(404);
  });
});
