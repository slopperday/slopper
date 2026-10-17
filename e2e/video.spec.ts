import type { APIRequestContext } from "@playwright/test";
import { bucketObjects, checkRequests, expect, type SeededSlop, test } from "./fixtures.ts";
import type { Stack } from "./ports.ts";

/** The smallest file that reads as an MP4: an `ftyp` box. */
const MP4 = Buffer.from([0, 0, 0, 24, ...Buffer.from("ftypisom"), 0, 0, 2, 0, ...Buffer.from("isomiso2")]);

/** An MP4 the fake check "watches" and finds a marker in (e2e/stack.ts). */
function mp4With(marker: string): Buffer {
  return Buffer.concat([MP4, Buffer.from(marker)]);
}

/** Uploads a video through the REST API and puts it on the slop, as an agent would. */
async function sendVideo(
  request: APIRequestContext,
  stack: Stack,
  token: string,
  slop: SeededSlop,
  bytes: Buffer,
): Promise<{ slop: { id: string; video: string } }> {
  const auth = { authorization: `Bearer ${token}` };
  const uploaded = await request.post(`${stack.appUrl}/api/v1/videos`, {
    headers: { ...auth, "content-type": "video/mp4" },
    data: bytes,
  });
  expect(uploaded.status()).toBe(201);
  const { id } = (await uploaded.json()) as { id: string };
  const set = await request.put(`${stack.appUrl}/api/v1/slops/${slop.slug}/video`, {
    headers: auth,
    data: { video: id },
  });
  expect(set.ok()).toBe(true);
  return (await set.json()) as { slop: { id: string; video: string } };
}

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
    const review = moderator
      .getByRole("region", { name: "Videos to review" })
      .getByRole("article", { name: slop.name });
    await expect(review.locator("video")).toHaveAttribute("src", /videos\/.+\.mp4$/);
    await review.getByRole("button", { name: "Approve video" }).click();
    await expect(moderator.getByRole("status")).toContainText(`${slop.name}: its video plays for everyone now.`);
    await expect(moderator.getByRole("status")).toContainText(`@${maker.username} is trusted`);

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

test.describe("the moderation team", () => {
  test("an admin makes someone a moderator, who approves a video and nothing else", async ({
    seed,
    stack,
    request,
  }) => {
    const maker = await seed.user("promo");
    const slop = await seed.slop(maker);
    expect(await sendVideo(request, stack, await seed.apiToken(maker), slop, MP4)).toMatchObject({
      slop: { video: "pending" },
    });
    const helper = await seed.user("helper");
    const helperPage = await seed.pageAs(helper);
    expect((await helperPage.goto("/mod"))?.status()).toBe(404);

    const admin = await seed.pageAs(await seed.admin());
    await admin.goto("/mod");
    await admin.getByRole("link", { name: "Moderation team" }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText("Moderation team");
    await admin.getByLabel("Username").fill(`@${helper.username}`);
    await admin.getByRole("button", { name: "Find" }).click();
    const found = admin
      .getByRole("list", { name: "Accounts found" })
      .getByRole("listitem", { name: `@${helper.username}` });
    await expect(found).toContainText("Not on the team");
    await found.getByRole("button", { name: "Make moderator" }).click();
    await expect(admin.getByRole("status")).toHaveText(`@${helper.username} is a moderator now.`);
    await expect(
      admin.getByRole("region", { name: "The team" }).getByRole("listitem", { name: `@${helper.username}` }),
    ).toContainText("Moderator");

    // The new moderator finds the queue in their menu and approves the video.
    await helperPage.goto("/");
    await helperPage.getByLabel("Account menu").click();
    await expect(helperPage.getByRole("link", { name: "Moderation team" })).toHaveCount(0);
    await helperPage.getByRole("link", { name: "Moderation", exact: true }).click();
    const review = helperPage
      .getByRole("region", { name: "Videos to review" })
      .getByRole("article", { name: slop.name });
    await review.getByRole("button", { name: "Approve video" }).click();
    await expect(helperPage.getByRole("status")).toContainText(`${slop.name}: its video plays for everyone now.`);

    // Nothing else: the team and trust are for admins.
    expect((await helperPage.goto("/mod/team"))?.status()).toBe(404);
    await helperPage.goto("/mod");
    await expect(helperPage.getByRole("region", { name: "Trusted makers" })).toHaveCount(0);
    await admin.goto("/mod");
    await expect(
      admin
        .getByRole("region", { name: "Trusted makers" })
        .getByRole("listitem")
        .filter({ hasText: `@${maker.username}` }),
    ).toContainText(`trusted by @${helper.username}`);
  });

  test("a trusted maker's next video is checked and plays at once", async ({ seed, stack, request }) => {
    const maker = await seed.user("trusted");
    await seed.trust(maker);
    const slop = await seed.slop(maker);
    const token = await seed.apiToken(maker);

    expect(await sendVideo(request, stack, token, slop, MP4)).toMatchObject({ slop: { video: "live" } });
    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    await expect(visitor.getByRole("region", { name: "Promo video" }).locator("video")).toHaveAttribute(
      "src",
      /videos\/.+\.mp4$/,
    );
    // The video model watched it, inline, under the same policy as everything else.
    expect(
      (await checkRequests(stack)).filter(
        (check) => check.videos === 1 && check.model === "google/gemini-3.1-flash-lite",
      ),
    ).not.toHaveLength(0);

    // An admin sees what it decided, and can revoke the trust.
    const admin = await seed.pageAs(await seed.admin());
    await admin.goto("/mod");
    const decision = admin
      .getByRole("region", { name: "Checked automatically" })
      .getByRole("listitem", { name: slop.name });
    await expect(decision).toContainText("Went live");
    await expect(decision).toContainText("google/gemini-3.1-flash-lite via google-ai-studio");
    await decision.getByRole("button", { name: `Revoke @${maker.username}'s trust` }).click();
    await expect(admin.getByRole("status")).toHaveText(`@${maker.username}'s videos wait for a moderator again.`);

    const next = await seed.slop(maker);
    expect(await sendVideo(request, stack, token, next, MP4)).toMatchObject({ slop: { video: "pending" } });
  });

  test("a video the check doesn't pass waits for a moderator", async ({ seed, stack, request }) => {
    const maker = await seed.user("edgy");
    await seed.trust(maker);
    const token = await seed.apiToken(maker);
    const blocked = await seed.slop(maker, { name: `Blocked ${Date.now().toString(36)}` });
    const broken = await seed.slop(maker, { name: `Broken ${Date.now().toString(36)}` });

    expect(await sendVideo(request, stack, token, blocked, mp4With("[e2e:blocked]"))).toMatchObject({
      slop: { video: "pending" },
    });
    // A check that fails is no pass either.
    expect(await sendVideo(request, stack, token, broken, mp4With("[e2e:error]"))).toMatchObject({
      slop: { video: "pending" },
    });
    const own = await seed.pageAs(maker);
    await own.goto(blocked.path);
    await expect(own.getByRole("status")).toContainText("Your video is waiting for a moderator.");
    const visitor = await seed.visitorPage();
    await visitor.goto(blocked.path);
    await expect(visitor.locator("video")).toHaveCount(0);

    const moderator = await seed.pageAs(await seed.moderator());
    await moderator.goto("/mod");
    const queue = moderator.getByRole("region", { name: "Videos to review" });
    await expect(queue.getByRole("article", { name: broken.name })).toContainText("Video check: Couldn't check");
    const review = queue.getByRole("article", { name: blocked.name });
    await expect(review).toContainText("Video check: Blocked");
    await review.getByRole("button", { name: "Take it off" }).click();
    await expect(moderator.getByRole("status")).toHaveText(`${blocked.name}: its video is gone.`);
  });
});
