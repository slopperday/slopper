import { createElement } from "react";
import type { MetaDescriptor } from "react-router";
import { describe, expect, it, vi } from "vite-plus/test";
import { cardImage, cardResponse, plainText, ProfileCard, renderCard, SlopCard } from "~/.server/cards";
import { CARD_SIZE, profileCardData, profileCardPath, slopCardPath } from "~/lib/cards";
import type { GoalProgress } from "~/lib/goal";
import { seo, videoType } from "~/lib/seo";

const SLOP = {
  slug: "slopper",
  name: "Slopper",
  tagline: "Throw slop at the wall every day.",
  launchLabel: null,
  number: 1,
  goalDay: 1,
  goalLength: 7,
  upvotes: 12,
  slopOfTheDay: null,
  slopcessfulAt: null,
  screenshots: ["https://media.test/screenshots/cover.png"],
  nsfw: false,
};

const PROGRESS: GoalProgress = {
  goal: { title: "7 slops in 7 days", target: 7, days: 7, startDate: "2026-10-17", abandonedAt: null },
  endDate: "2026-10-23",
  currentDay: 2,
  shipped: 1,
  status: "active",
  days: (["shipped", "today", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"] as const).map(
    (state, index) => ({ day: index + 1, date: `2026-10-${17 + index}`, state, launches: [], queued: 0 }),
  ),
};
const PROFILE = {
  owner: { displayName: "Ifiok Jr.", username: "ifiokjr" },
  totalShipped: 1,
  streak: 1,
  daysWon: 0,
  progress: PROGRESS,
};

/** Width and height from a PNG's IHDR chunk. */
function pngSize(png: Uint8Array): { width: number; height: number } {
  expect(png.slice(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const view = new DataView(png.buffer, png.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A tiny real PNG to stand in for a screenshot. */
async function screenshotPng(): Promise<Uint8Array<ArrayBuffer>> {
  return renderCard(createElement("div", { style: { display: "flex", width: 10, height: 10, background: "red" } }));
}

function content(tags: MetaDescriptor[], key: string): string | undefined {
  const tag = tags.find((candidate) => "property" in candidate && candidate.property === key) as
    | { content: string }
    | undefined;
  const named = tags.find((candidate) => "name" in candidate && candidate.name === key) as
    | { content: string }
    | undefined;
  return (tag ?? named)?.content;
}

describe("share cards", () => {
  it("draws slop and profile cards at the size link previews ask for", async () => {
    const screenshot = `data:image/png;base64,${Buffer.from(await screenshotPng()).toString("base64")}`;
    const cards = [
      createElement(SlopCard, { slop: SLOP, username: "ifiokjr", screenshot }),
      createElement(SlopCard, {
        slop: { ...SLOP, name: "A ✨ much longer slop name 🚀🇬🇧", slopcessfulAt: 1 },
        username: "x",
        screenshot: null,
      }),
      createElement(ProfileCard, profileCardData(PROFILE)),
      createElement(ProfileCard, profileCardData({ ...PROFILE, progress: null })),
      createElement(
        ProfileCard,
        profileCardData({
          ...PROFILE,
          progress: {
            ...PROGRESS,
            days: Array.from({ length: 30 }, (_, index) => ({ ...PROGRESS.days[0], day: index + 1 })),
          },
        }),
      ),
    ];
    for (const card of cards) expect(pngSize(await renderCard(card))).toEqual(CARD_SIZE);
  });

  it("serves cards as cacheable PNGs", async () => {
    const response = cardResponse(await screenshotPng());
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(response.headers.get("netlify-cdn-cache-control")).toContain("durable");
  });

  it("drops emoji the fonts can't draw instead of drawing empty boxes", () => {
    expect(plainText("Slopper 🚀 v2 ✨")).toBe("Slopper v2");
    expect(plainText("👍🏽 Thumbs 🇬🇧 👨‍👩‍👧")).toBe("Thumbs");
    expect(plainText("Café · naïve")).toBe("Café · naïve");
  });

  it("embeds PNG and JPEG screenshots, and skips anything else", async () => {
    const png = await screenshotPng();
    const ok = vi.fn<typeof fetch>(async () => new Response(png, { headers: { "content-type": "image/png" } }));
    expect(await cardImage("https://media.test/a.png", ok)).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);

    const webp = vi.fn<typeof fetch>(async () => new Response(png, { headers: { "content-type": "image/webp" } }));
    expect(await cardImage("https://media.test/a.webp", webp)).toBeNull();
    const missing = vi.fn<typeof fetch>(async () => new Response("gone", { status: 404 }));
    expect(await cardImage("https://media.test/gone.png", missing)).toBeNull();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await cardImage("https://media.test/a.png", down)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("gives a card a new URL when what it shows changes, and only then", () => {
    const path = slopCardPath("ifiokjr", SLOP);
    expect(path).toMatch(/^\/@ifiokjr\/slopper\/card\.png\?v=[0-9a-z]+$/);
    expect(slopCardPath("ifiokjr", { ...SLOP })).toBe(path);
    expect(slopCardPath("ifiokjr", { ...SLOP, upvotes: 13 })).not.toBe(path);
    expect(slopCardPath("ifiokjr", { ...SLOP, slopOfTheDay: "2026-10-17" })).not.toBe(path);
    // A card for an NSFW slop shows no screenshot, so it changes too.
    expect(slopCardPath("ifiokjr", { ...SLOP, nsfw: true })).not.toBe(path);

    const profile = profileCardPath(profileCardData(PROFILE));
    expect(profile).toMatch(/^\/@ifiokjr\/card\.png\?v=[0-9a-z]+$/);
    expect(profileCardPath(profileCardData({ ...PROFILE, streak: 2 }))).not.toBe(profile);
  });

  it("leaves an abandoned goal off a profile card", () => {
    expect(profileCardData(PROFILE).goal).toMatchObject({ title: "7 slops in 7 days", shipped: 1, currentDay: 2 });
    expect(profileCardData({ ...PROFILE, progress: { ...PROGRESS, status: "abandoned" } }).goal).toBeNull();
  });
});

describe("link preview tags", () => {
  const matches = [{ id: "root", loaderData: { origin: "https://slopper.day" } }];

  it("describes the cover card by default", () => {
    const tags = seo(matches);
    expect(content(tags, "og:image")).toBe("https://slopper.day/og.png");
    expect(content(tags, "og:image:width")).toBe("1200");
    expect(content(tags, "og:image:height")).toBe("630");
    expect(content(tags, "og:image:alt")).toContain("Too much slop? Not enough yet!");
    expect(content(tags, "twitter:card")).toBe("summary_large_image");
    expect(content(tags, "twitter:image:alt")).toBe(content(tags, "og:image:alt"));
    expect(content(tags, "og:type")).toBe("website");
    expect(content(tags, "og:video")).toBeUndefined();
  });

  it("adds the card, the video, the type and Slack's labels", () => {
    const tags = seo(matches, {
      title: "Slopper by @ifiokjr",
      image: { url: "/@ifiokjr/slopper/card.png?v=1", ...CARD_SIZE, alt: "Slopper by @ifiokjr" },
      video: "https://media.test/videos/promo.mp4",
      type: { kind: "article", properties: { "article:published_time": "2026-10-17T09:00:00.000Z" } },
      labels: [
        ["Slop", "#0001 · Day 1/7"],
        ["Upvotes", "12"],
      ],
      path: "/@ifiokjr/slopper",
    });
    expect(content(tags, "og:image")).toBe("https://slopper.day/@ifiokjr/slopper/card.png?v=1");
    expect(content(tags, "twitter:image")).toBe(content(tags, "og:image"));
    expect(content(tags, "og:video")).toBe("https://media.test/videos/promo.mp4");
    expect(content(tags, "og:video:secure_url")).toBe("https://media.test/videos/promo.mp4");
    expect(content(tags, "og:video:type")).toBe("video/mp4");
    expect(content(tags, "og:type")).toBe("article");
    expect(content(tags, "article:published_time")).toBe("2026-10-17T09:00:00.000Z");
    expect(content(tags, "twitter:label1")).toBe("Slop");
    expect(content(tags, "twitter:data1")).toBe("#0001 · Day 1/7");
    expect(content(tags, "twitter:data2")).toBe("12");
    expect(content(tags, "og:url")).toBe("https://slopper.day/@ifiokjr/slopper");
  });

  it("only offers videos players can show", () => {
    expect(videoType("https://media.test/videos/a.MP4")).toBe("video/mp4");
    expect(videoType("https://media.test/videos/a.webm?x=1")).toBe("video/webm");
    expect(videoType("https://convex.test/api/storage/abc")).toBeNull();
    expect(content(seo(matches, { video: "https://convex.test/api/storage/abc" }), "og:video")).toBeUndefined();
  });
});
