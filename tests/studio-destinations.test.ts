// @vitest-environment edge-runtime
import { describe, expect, it } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { wallTime } from "~/lib/csv";
import {
  type DestinationAccount,
  type DestinationPost,
  destinationFor,
  readiness,
  readinessLabel,
  xTwins,
} from "~/lib/destinations";
import { SOCIAL_PROVIDERS } from "~/lib/networks";
import { callbackPath, SETUP_GUIDES } from "~/lib/setupGuides";
import { convexApp } from "./convexApp";

const image = { id: "img1", kind: "image" as const };
const second = { id: "img2", kind: "image" as const };

function base(change: Partial<DestinationPost> = {}): DestinationPost {
  return { text: "Tiltmaze 2.0 is out", link: null, media: [], overrides: {}, options: {}, ...change };
}

const x1: DestinationAccount = { id: "a1", provider: "x", handle: "tiltmaze" };
const x2: DestinationAccount = { id: "a2", provider: "x", handle: "slopper" };
const insta: DestinationAccount = { id: "a3", provider: "instagram", handle: "tiltmaze.app" };
const linkedin: DestinationAccount = { id: "a4", provider: "linkedin", handle: "ifiok" };

describe("what each destination posts", () => {
  it("takes an account's version first, then its network's, then the shared one", () => {
    const post = base({
      link: "https://tiltmaze.app",
      media: [image, second],
      firstComment: "Shared comment",
      overrides: { x: "For X", a2: "For @slopper" },
      variants: {
        x: { link: null, firstComment: "X comment" },
        a2: { media: ["img2"] },
        linkedin: { link: "https://tiltmaze.app/blog" },
      },
    });
    const one = destinationFor(post, x1);
    expect(one).toMatchObject({ text: "For X", link: null, firstComment: "X comment" });
    expect(one.media.map((item) => item.id)).toEqual(["img1", "img2"]);
    expect(one.own).toEqual({ text: true, link: true, media: false, firstComment: true });

    const two = destinationFor(post, x2);
    expect(two.text).toBe("For @slopper");
    expect(two.media.map((item) => item.id)).toEqual(["img2"]);

    const profile = destinationFor(post, linkedin);
    expect(profile).toMatchObject({
      text: "Tiltmaze 2.0 is out",
      link: "https://tiltmaze.app/blog",
      firstComment: "Shared comment",
    });
    expect(profile.own.text).toBe(false);
  });

  it("finds X accounts that would post the same words, unless spintax varies them", () => {
    expect(xTwins(base(), x1, [x1, x2])).toEqual(["slopper"]);
    expect(xTwins(base({ overrides: { a2: "Something else" } }), x1, [x1, x2])).toEqual([]);
    expect(xTwins(base({ text: "Tiltmaze 2.0 is {out|live}" }), x1, [x1, x2])).toEqual([]);
    expect(xTwins(base(), insta, [x1, x2, insta])).toEqual([]);
  });

  it("lists what stands in each destination's way, worst first", () => {
    const issues = readiness(base({ link: "https://tiltmaze.app" }), insta, [insta]);
    expect(issues[0]).toMatchObject({ level: "block", field: "media" });
    expect(issues.some((issue) => issue.level === "info" && issue.field === "link")).toBe(true);
    expect(readinessLabel(issues)).toMatchObject({ tone: "block", text: "Instagram needs a picture or a video." });

    expect(readinessLabel(readiness(base(), linkedin, [linkedin]))).toEqual({ tone: "ready", text: "Ready" });
    const twin = readiness(base(), x1, [x1, x2]).find((issue) => issue.field === "copy");
    expect(twin?.message).toMatch(/Same words as @slopper/);
    const broken = readiness(base(), { ...linkedin, broken: "LinkedIn signed you out" }, [linkedin]);
    expect(broken[0]).toMatchObject({ level: "block", field: "account" });
    expect(readiness(base({ text: "" }), linkedin, [linkedin])[0].message).toBe("Write something or add media.");
    expect(readiness(base({ text: "a".repeat(400) }), x1, [x1]).some((issue) => issue.level === "warn")).toBe(true);
  });

  it("says what X bills, and more for a link", () => {
    const price = (link: string | null) =>
      readiness(base({ link }), x1, [x1]).find((issue) => issue.message.startsWith("X bills"))?.message;
    expect(price(null)).toContain("$0.015");
    expect(price("https://tiltmaze.app")).toContain("$0.20");
  });
});

describe("times people type", () => {
  it("reads wall times in their zone, either side of a clock change", () => {
    expect(new Date(wallTime("2026-03-29 09:00", "Europe/London")!).toISOString()).toBe("2026-03-29T08:00:00.000Z");
    expect(new Date(wallTime("2026-03-28 09:00", "Europe/London")!).toISOString()).toBe("2026-03-28T09:00:00.000Z");
    expect(new Date(wallTime("2026-11-24T09:30", "America/New_York")!).toISOString()).toBe("2026-11-24T14:30:00.000Z");
    expect(new Date(wallTime("2026-07-01T09:30", "America/New_York")!).toISOString()).toBe("2026-07-01T13:30:00.000Z");
    expect(wallTime("2026-07-01T09:30Z", "America/New_York")).toBe(Date.parse("2026-07-01T09:30Z"));
    expect(new Date(wallTime("2026-07-01 09:30", "Not/AZone")!).toISOString()).toBe("2026-07-01T09:30:00.000Z");
    expect(wallTime("next tuesday", "UTC")).toBeNull();
  });
});

describe("setup guides", () => {
  it("covers every network, with the redirect address its app needs", () => {
    expect(SETUP_GUIDES.map((guide) => guide.network).sort()).toEqual([...SOCIAL_PROVIDERS].sort());
    for (const guide of SETUP_GUIDES) expect(guide.you.length).toBeGreaterThan(0);
    expect(callbackPath("instagram")).toBe("/auth/facebook/callback");
    expect(callbackPath("youtube")).toBe("/auth/google/callback");
    expect(callbackPath("reddit")).toBe("/auth/reddit/callback");
  });
});

function setup() {
  const t = convexApp();
  return t.withIdentity({ subject: "server" });
}
type Server = ReturnType<typeof setup>;

async function makeUser(server: Server, name: string): Promise<Id<"users">> {
  const { userId } = await server.mutation(api.users.upsertFromIdentity, {
    provider: "dev",
    providerId: name,
    preferredUsername: name,
    displayName: name,
    avatarUrl: null,
    timeZone: "UTC",
  });
  return userId;
}

async function connect(server: Server, userId: Id<"users">, provider: "x" | "linkedin", handle: string) {
  return await server.mutation(api.accounts.connect, {
    userId,
    provider,
    remoteId: `${provider}-${handle}`,
    handle,
    displayName: handle,
    avatarUrl: null,
    sealedCredentials: "sealed",
    expiresAt: null,
  });
}

const post = {
  productId: null,
  text: "Shipped it",
  link: null,
  media: [],
  overrides: {},
  options: {},
  scheduledAt: null,
};

describe("destinations in Convex", () => {
  it("refuses the same words on two X accounts, except in a draft", async () => {
    const server = setup();
    const userId = await makeUser(server, "maker");
    const a = await connect(server, userId, "x", "tiltmaze");
    const b = await connect(server, userId, "x", "slopper");
    await expect(server.mutation(api.social.create, { ...post, userId, accountIds: [a._id, b._id] })).rejects.toThrow(
      "doesn't allow",
    );
    const draft = await server.mutation(api.social.create, {
      ...post,
      userId,
      accountIds: [a._id, b._id],
      draft: true,
    });
    expect(draft).toBeTruthy();
  });

  it("keeps ideas with no accounts, and remembers the last accounts used", async () => {
    const server = setup();
    const userId = await makeUser(server, "maker");
    const idea = await server.mutation(api.social.create, { ...post, userId, accountIds: [], draft: true });
    expect((await server.query(api.social.get, { userId, postId: idea }))?.deliveries).toEqual([]);
    await expect(server.mutation(api.social.create, { ...post, userId, accountIds: [] })).rejects.toThrow();

    const account = await connect(server, userId, "linkedin", "ifiok");
    await server.mutation(api.social.create, { ...post, userId, accountIds: [account._id], draft: true });
    expect((await server.query(api.studio.settings, { userId })).lastAccountIds).toEqual([account._id]);
  });

  it("gives each account its own time and keeps variant media among the post's uploads", async () => {
    const server = setup();
    const userId = await makeUser(server, "maker");
    const a = await connect(server, userId, "x", "tiltmaze");
    const b = await connect(server, userId, "linkedin", "ifiok");
    const at = Date.now() + 3_600_000;
    const later = at + 7_200_000;
    const postId = await server.mutation(api.social.create, {
      ...post,
      userId,
      accountIds: [a._id, b._id],
      scheduledAt: at,
      times: { [b._id]: later, someoneElse: later },
      variants: { linkedin: { link: "https://tiltmaze.app/blog" }, mastodon: { link: "https://elsewhere" } },
    });
    const shaped = await server.query(api.social.get, { userId, postId });
    expect(shaped?.times).toEqual({ [b._id]: later });
    expect(shaped?.variants).toEqual({ linkedin: { link: "https://tiltmaze.app/blog" } });
    expect(shaped?.deliveries.find((row) => row.accountId === b._id)?.notBefore).toBe(later);

    await expect(
      server.mutation(api.social.create, {
        ...post,
        userId,
        accountIds: [a._id],
        variants: { x: { media: ["not-an-upload"] } },
      }),
    ).rejects.toThrow("one of the post's uploads");
    await expect(
      server.mutation(api.social.create, {
        ...post,
        userId,
        accountIds: [a._id],
        times: { [a._id]: Date.now() - 3_600_000 },
      }),
    ).rejects.toThrow("in the future");
  });

  it("never retries an uncertain copy on its own, and settles it the way its owner says", async () => {
    const server = setup();
    const userId = await makeUser(server, "maker");
    const a = await connect(server, userId, "x", "tiltmaze");
    const b = await connect(server, userId, "linkedin", "ifiok");
    const postId = await server.mutation(api.social.create, { ...post, userId, accountIds: [a._id, b._id] });
    const claimed = await server.mutation(api.social.claim, { postId });
    const [first, second] = claimed!.deliveries;
    for (const row of [first, second]) {
      await server.mutation(api.social.record, {
        deliveryId: row._id,
        result: { status: "error", message: "Lost mid-send", uncertain: true },
      });
    }
    expect(await server.mutation(api.social.retry, { userId, postId })).toBe(0);

    const other = await makeUser(server, "other");
    expect(
      await server.mutation(api.social.resolveUncertain, { userId: other, deliveryId: first._id, outcome: "posted" }),
    ).toBe(false);

    expect(
      await server.mutation(api.social.resolveUncertain, {
        userId,
        deliveryId: first._id,
        outcome: "posted",
        url: "https://x.com/tiltmaze/status/9",
      }),
    ).toBe(true);
    const posted = await server.query(api.social.delivery, { deliveryId: first._id });
    expect(posted).toMatchObject({ status: "ok", url: "https://x.com/tiltmaze/status/9" });
    expect(posted?.uncertain).toBeUndefined();

    expect(
      await server.mutation(api.social.resolveUncertain, { userId, deliveryId: second._id, outcome: "resend" }),
    ).toBe(true);
    expect((await server.query(api.social.delivery, { deliveryId: second._id }))?.status).toBe("queued");
    // Settled copies can't be settled again.
    expect(
      await server.mutation(api.social.resolveUncertain, { userId, deliveryId: first._id, outcome: "resend" }),
    ).toBe(false);
  });
});
