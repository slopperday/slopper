import { mkdirSync } from "node:fs";
import type { Id } from "../convex/_generated/dataModel.js";
import { api } from "../convex/_generated/api.js";
import { expect, test } from "./fixtures.ts";

/**
 * The studio: write once, post as several brands on several networks, and
 * read back how each copy did. Accounts are seeded with credentials that
 * can't reach any network, so nothing here sends; the sent post and its
 * stats are recorded as the app server would record them.
 *
 * With STUDIO_SCREENSHOTS set, it saves the pages to docs/studio/.
 */

const SHOTS = process.env.STUDIO_SCREENSHOTS ? "docs/studio" : null;

/** A full-page picture from the top, so the sticky header sits where it belongs. */
async function shoot(page: import("@playwright/test").Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

function avatar(letter: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}"/><text x="32" y="42" font-family="Arial" font-weight="700" font-size="30" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

test("one post goes to each brand's accounts, fitted per network, and its stats come back", async ({
  seed,
  convex,
  page: blank,
}) => {
  const owner = await seed.user("studio");
  await seed.slop(owner, { name: "Tiltmaze", tagline: "Tilt your phone to roll the ball home" });

  const accounts: Record<string, Id<"accounts">> = {};
  const add = async (
    key: string,
    provider: "x" | "instagram" | "facebook" | "youtube" | "threads" | "tiktok" | "linkedin" | "bluesky",
    handle: string,
    displayName: string,
    brand: string | undefined,
    color: string,
  ) => {
    const account = await convex.mutation(api.accounts.connect, {
      userId: owner.id,
      provider,
      remoteId: `${provider}-${handle}-${owner.username}`,
      handle,
      displayName,
      avatarUrl: avatar(displayName.slice(0, 1), color),
      sealedCredentials: "not-a-real-credential",
      expiresAt: null,
      initialMode: "off",
      ...(brand ? { brand } : {}),
    });
    accounts[key] = account._id;
  };
  await add("tiltX", "x", "tiltmaze", "Tiltmaze", "Tiltmaze", "#7c3aed");
  await add("tiltIg", "instagram", "tiltmaze.app", "Tiltmaze", "Tiltmaze", "#7c3aed");
  await add("tiltFb", "facebook", "Tiltmaze", "Tiltmaze", "Tiltmaze", "#7c3aed");
  await add("tiltYt", "youtube", "tiltmaze", "Tiltmaze", "Tiltmaze", "#7c3aed");
  await add("slopX", "x", "slopperday", "Slopper", "Slopper", "#16a34a");
  await add("slopThreads", "threads", "slopperday", "Slopper", "Slopper", "#16a34a");
  await add("slopTikTok", "tiktok", "slopperday", "Slopper", "Slopper", "#16a34a");
  await add("meLinkedIn", "linkedin", "Ifiok Jr.", "Ifiok Jr.", "Me", "#0a66c2");
  await add("meBluesky", "bluesky", "ifiok.bsky.social", "Ifiok", "Me", "#1185fe");

  // A post that went out yesterday, with each network's stats as they were read back.
  const sentId = await convex.mutation(api.social.create, {
    userId: owner.id,
    productId: null,
    text: "Tiltmaze 2.0 is out: 40 new levels, a level editor, and daily challenges. Tilt to play.",
    link: "https://tiltmaze.app/",
    media: [],
    overrides: { x: "Tiltmaze 2.0: 40 new levels + a level editor. Tilt to play 🎱" },
    options: {},
    accountIds: [accounts.tiltX, accounts.tiltFb, accounts.slopThreads, accounts.meLinkedIn, accounts.meBluesky],
    scheduledAt: null,
  });
  const claimed = await convex.mutation(api.social.claim, { postId: sentId });
  const stats: Record<
    string,
    { views?: number; likes?: number; comments?: number; shares?: number; reposts?: number }
  > = {
    x: { views: 18_400, likes: 412, comments: 37, reposts: 58 },
    facebook: { likes: 236, comments: 19, shares: 41 },
    threads: { views: 6_120, likes: 288, comments: 24, reposts: 12, shares: 9 },
    bluesky: { likes: 97, comments: 11, reposts: 23 },
  };
  for (const row of claimed!.deliveries) {
    if (row.provider === "linkedin") {
      await convex.mutation(api.social.record, {
        deliveryId: row._id,
        result: {
          status: "error",
          message: "LinkedIn connections last 60 days. Reconnect the account.",
          uncertain: false,
        },
      });
      continue;
    }
    await convex.mutation(api.social.record, {
      deliveryId: row._id,
      result: { status: "ok", remoteId: `${row.provider}-1`, url: `https://example.com/${row.provider}/1` },
    });
  }
  await convex.mutation(api.social.recordMetrics, {
    entries: claimed!.deliveries
      .filter((row) => stats[row.provider])
      .map((row) => ({ deliveryId: row._id, metrics: stats[row.provider] })),
  });

  // A picture to post, drawn here.
  await blank.setContent(
    `<div style="width:1200px;height:900px;display:grid;place-items:center;background:linear-gradient(135deg,#7c3aed,#ec4899 55%,#f59e0b);font:800 120px system-ui;color:white;text-align:center">Tiltmaze<br><span style="font-size:64px">2.0 · 40 new levels</span></div>`,
  );
  await blank.setViewportSize({ width: 1200, height: 900 });
  const picture = await blank.screenshot();

  const page = await seed.pageAs(owner);
  await page.setViewportSize({ width: 1360, height: 1000 });
  await page.goto("/studio");
  await expect(page.getByRole("heading", { name: "Studio", level: 1 })).toBeVisible();

  // Pick the Tiltmaze brand in one tap, plus the personal Bluesky.
  await page.getByRole("group", { name: "Tiltmaze" }).getByRole("button", { name: "All" }).click();
  await page
    .getByRole("group", { name: "Me" })
    .getByRole("button", { name: /Bluesky/ })
    .click();
  await page
    .getByLabel("Post", { exact: true })
    .fill(
      "Tiltmaze 2.0 is out: 40 new levels, a level editor, and daily challenges. Built in a weekend, polished for a month. Tilt your phone to roll the ball home, and share your own mazes with friends. Free on iOS and Android.",
    );
  await page.getByLabel("Link").fill("https://tiltmaze.app/");
  // Without media, the checklist says which accounts can't take it, before anything is sent.
  const checklist = page.getByRole("list", { name: "Checklist" });
  await expect(checklist).toContainText("Instagram needs a picture or a video.");
  await expect(checklist).toContainText("YouTube needs a video.");
  await expect(checklist).toContainText("X bills the developer app");
  await expect(page.getByRole("button", { name: /Post to 5 accounts/ })).toBeDisabled();
  await shoot(page, "1-compose-needs-media");

  // YouTube needs a video: leave it out, add a picture for Instagram.
  await page
    .getByRole("group", { name: "Tiltmaze" })
    .getByRole("button", { name: /YouTube needs a video/ })
    .click();
  await page.locator('input[type="file"][accept^="image"]').setInputFiles({
    name: "tiltmaze.png",
    mimeType: "image/png",
    buffer: picture,
  });
  await expect(page.getByLabel("Uploading")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Post to 4 accounts/ })).toBeEnabled();
  await expect(checklist.getByRole("listitem").filter({ hasText: "tiltmaze.app" })).toContainText("Ready");
  // X is over its 280 characters: say it shorter there.
  await page.getByRole("button", { name: "X", exact: true }).click();
  await page
    .getByLabel("Words for X")
    .fill("Tiltmaze 2.0 is out: 40 new levels, a level editor and daily challenges 🎱");
  const previews = page.getByRole("complementary", { name: "Previews" });
  await expect(previews.getByRole("group", { name: "Choose account to preview" }).getByRole("button")).toHaveCount(4);
  await expect(previews.getByRole("article")).toHaveCount(1);
  await expect(previews.getByRole("article", { name: "X preview" })).toContainText("40 new levels, a level editor");
  await previews.getByRole("button", { name: "Instagram: tiltmaze.app" }).click();
  await expect(previews.getByRole("article", { name: "Instagram preview" })).toBeVisible();
  await previews.getByRole("button", { name: "X: tiltmaze", exact: true }).click();
  await expect(previews.getByRole("article", { name: "X preview" })).toBeVisible();
  // A thread for X and Bluesky, and a first comment, then save it as a draft instead of sending.
  await page.getByRole("button", { name: "Add a post" }).click();
  await page.getByLabel("Thread post 2").fill("Build a maze, share the link, watch friends fail at it.");
  await page.getByLabel("First comment", { exact: true }).fill("#indiegames #buildinpublic");
  await expect(previews.getByRole("article", { name: "X preview" })).toContainText("Build a maze, share the link");
  await expect(previews.getByRole("article", { name: "X preview" })).toContainText("#indiegames #buildinpublic");
  await page.getByText("More options").click();
  await page.getByLabel("Tags").fill("launch, tiltmaze");
  await page.getByLabel("Note to self").fill("Check the App Store link is live first.");
  await shoot(page, "2-compose-ready");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved. Nothing goes out until you post it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Make a preview link" })).toBeVisible();
  const draftUrl = page.url();

  // A preview link a client opens without an account, and says what they think.
  await page.getByRole("button", { name: "Make a preview link" }).click();
  const reviewUrl = (await page.locator("code").filter({ hasText: "/review/" }).textContent())!.trim();
  const client = await seed.visitorPage();
  await client.setViewportSize({ width: 1360, height: 1000 });
  await client.goto(new URL(reviewUrl).pathname);
  await expect(client.getByRole("heading", { name: "How it will look" })).toBeVisible();
  await expect(client.getByRole("article", { name: "X preview" })).toBeVisible();
  await expect(client.getByText("Build a maze, share the link")).toBeVisible();
  expect(await client.content()).not.toContain("Check the App Store link");
  await client.getByLabel("Your name").fill("Sam from Tiltmaze");
  await client.getByLabel("Note").fill("Lead with the level editor.");
  await shoot(client, "6-preview-link");
  await client.getByRole("button", { name: "Needs changes" }).click();
  await expect(client.getByText("Thanks. The maker can see what you said.")).toBeVisible();
  await page.goto(draftUrl);
  await expect(page.getByRole("list", { name: "Feedback" })).toContainText("Lead with the level editor.");
  await expect(page.getByText("Check the App Store link is live first.")).toBeVisible();
  await shoot(page, "7-draft-with-feedback");

  // The sent post: each account's copy, its status and its stats.
  await page.goto(`/studio/posts/${sentId}`);
  await expect(page.getByRole("heading", { name: "Across 5 accounts" })).toBeVisible();
  await expect(page.getByText("18.4K", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("table").getByText("LinkedIn connections last 60 days. Reconnect the account."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry failed" })).toBeVisible();
  await shoot(page, "3-post-results");

  await page.goto("/studio/analytics");
  await expect(page.getByRole("heading", { name: "How your posts did" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "By network" })).toBeVisible();
  await shoot(page, "4-analytics");

  // Scheduled posts on the calendar, with a tracked link whose clicks are counted per network.
  const later = await convex.mutation(api.social.create, {
    userId: owner.id,
    productId: null,
    text: "Level editor deep dive, live tomorrow",
    link: "https://tiltmaze.app/editor",
    media: [],
    overrides: {},
    options: {},
    accountIds: [accounts.tiltX, accounts.slopThreads],
    scheduledAt: Date.now() + 2 * 86_400_000,
    trackLinks: true,
    tags: ["editor"],
  });
  await convex.mutation(api.social.create, {
    userId: owner.id,
    productId: null,
    text: "Weekly changelog: 12 fixes",
    link: null,
    media: [],
    overrides: {},
    options: {},
    accountIds: [accounts.meBluesky, accounts.meLinkedIn],
    scheduledAt: Date.now() + 4 * 86_400_000,
    repeat: { everyDays: 7, remaining: 8 },
  });
  const tracked = (await convex.query(api.social.get, { userId: owner.id, postId: later }))!.links[0];
  const visitor = await seed.visitorPage();
  const followed = await visitor.request.get(`/go/${tracked.code}`, { maxRedirects: 0 });
  expect(followed.status()).toBe(302);
  expect(followed.headers().location).toContain("utm_medium=social");
  expect(
    (await convex.query(api.social.get, { userId: owner.id, postId: later }))!.links.find(
      (row) => row.code === tracked.code,
    )?.clicks,
  ).toBe(1);

  await page.goto("/studio/calendar");
  await expect(page.getByRole("link", { name: /Level editor deep dive/ })).toBeVisible();
  await shoot(page, "8-calendar");

  await page.goto("/studio/settings");
  await expect(page.getByRole("heading", { name: "Queue times" })).toBeVisible();
  await page.getByLabel("Kind").selectOption("hashtags");
  await page.getByLabel("Snippet name").fill("Indie games");
  await page.getByLabel("Snippet text").fill("#indiegames #gamedev #buildinpublic");
  await page.getByRole("button", { name: "Save snippet" }).click();
  await expect(page.getByText("#indiegames #gamedev #buildinpublic")).toBeVisible();
  await shoot(page, "9-studio-settings");

  await page.goto("/settings/autopost");
  await expect(page.getByLabel("Brand for Ifiok Jr.")).toHaveValue("Me");
  expect(await page.content()).not.toContain("not-a-real-credential");
  await shoot(page, "5-accounts");
});
