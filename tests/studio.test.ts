// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { nextMetricsAt } from "@convex/social";
import { fitPost, graphemeLength, xWeightedLength } from "~/lib/compose";
import { NETWORKS, optionProblems, SOCIAL_PROVIDERS, unsupportedReason } from "~/lib/networks";
import { chunkPlan } from "~/.server/social/tiktok";
import { convexApp } from "./convexApp";

function setup() {
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}
type Server = ReturnType<typeof setup>["server"];

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

async function connect(server: Server, userId: Id<"users">, provider: "x" | "instagram" | "youtube", handle: string) {
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

describe("what each network takes", () => {
  it("says why a network can't take a post before anything is sent", () => {
    expect(unsupportedReason("instagram", { images: 0, video: null })).toBe("Instagram needs a picture or a video.");
    expect(unsupportedReason("youtube", { images: 2, video: null })).toBe("YouTube needs a video.");
    expect(unsupportedReason("tiktok", { images: 0, video: 30 })).toBeNull();
    expect(unsupportedReason("bluesky", { images: 0, video: 30 })).toMatch(/can't take videos/);
    expect(unsupportedReason("x", { images: 5, video: null })).toBe("X takes up to 4 pictures.");
    expect(unsupportedReason("x", { images: 0, video: 600 })).toMatch(/up to 2 minutes/);
    expect(unsupportedReason("x", { images: 0, video: null })).toBeNull();
  });

  it("asks YouTube for a title and TikTok for an audience, with no default", () => {
    expect(optionProblems(new Set(["youtube"]), {})).toContain("Give the YouTube video a title.");
    expect(optionProblems(new Set(["tiktok"]), {})).toContain("Choose who can see the TikTok.");
    expect(
      optionProblems(new Set(["youtube", "tiktok"]), {
        youtube: { title: "Launch", privacy: "public", madeForKids: false },
        tiktok: {
          privacy: "SELF_ONLY",
          allowComments: true,
          allowDuet: true,
          allowStitch: true,
          brandedContent: true,
          yourBrand: false,
        },
      }),
    ).toEqual(["Branded content on TikTok can't be private."]);
  });

  it("fits the words to every network and keeps the link where links work", () => {
    const words = "slop ".repeat(2000);
    const link = "https://slopper.day/@ifiokjr/tiltmaze";
    for (const provider of SOCIAL_PROVIDERS) {
      const fitted = fitPost(provider, words, link);
      const measure =
        provider === "x" ? xWeightedLength : provider === "bluesky" ? graphemeLength : (s: string) => s.length;
      expect(measure(fitted)).toBeLessThanOrEqual(NETWORKS[provider].textLimit);
      if (provider === "instagram" || provider === "tiktok") expect(fitted).not.toContain(link);
      else expect(fitted.endsWith(link)).toBe(true);
    }
  });

  it("splits TikTok uploads the way TikTok wants them", () => {
    expect(chunkPlan(3 * 1024 * 1024)).toEqual({ chunkSize: 3 * 1024 * 1024, count: 1 });
    // 25 MB: two 10 MB chunks, the last one carrying the remainder.
    expect(chunkPlan(25 * 1024 * 1024)).toEqual({ chunkSize: 10 * 1024 * 1024, count: 2 });
  });
});

describe("studio posts in Convex", () => {
  it("makes one delivery per account, leases each once, and retries only failures", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    const a = await connect(server, userId, "x", "tiltmaze");
    const b = await connect(server, userId, "x", "slopper");
    // Two X accounts need their own words: X refuses the same automated post from both.
    const postId = await server.mutation(api.social.create, {
      ...post,
      userId,
      accountIds: [a._id, b._id],
      overrides: { [b._id]: "Shipped it, from the Slopper account" },
    });

    const claimed = await server.mutation(api.social.claim, { postId });
    expect(claimed?.deliveries.map((row) => row.handle).sort()).toEqual(["slopper", "tiltmaze"]);
    // A second caller gets nothing while the first holds the lease.
    expect(await server.mutation(api.social.claim, { postId })).toBeNull();

    const [first, second] = claimed!.deliveries;
    await server.mutation(api.social.record, {
      deliveryId: first._id,
      result: { status: "ok", remoteId: "1", url: "https://x.com/tiltmaze/status/1" },
    });
    await server.mutation(api.social.record, {
      deliveryId: second._id,
      result: { status: "error", message: "X turned it down", uncertain: false },
    });
    expect(await server.mutation(api.social.retry, { userId, postId })).toBe(1);
    const again = await server.mutation(api.social.claim, { postId });
    expect(again?.deliveries.map((row) => row._id)).toEqual([second._id]);
  });

  it("refuses accounts and uploads that belong to someone else", async () => {
    const { server } = setup();
    const maker = await makeUser(server, "maker");
    const other = await makeUser(server, "other");
    const theirs = await connect(server, other, "x", "theirs");
    await expect(
      server.mutation(api.social.create, { ...post, userId: maker, accountIds: [theirs._id] }),
    ).rejects.toThrow("isn't yours");
    const mine = await connect(server, maker, "x", "mine");
    await expect(
      server.mutation(api.social.create, {
        ...post,
        userId: maker,
        accountIds: [mine._id],
        media: [{ mediaId: "nope" }],
      }),
    ).rejects.toThrow("upload is gone");
    expect(await server.query(api.social.get, { userId: other, postId: "anything" })).toBeNull();
  });

  it("holds scheduled posts until their time, and lets them be cancelled", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    const account = await connect(server, userId, "instagram", "brand");
    const postId = await server.mutation(api.social.create, {
      ...post,
      userId,
      accountIds: [account._id],
      scheduledAt: Date.now() + 3_600_000,
    });
    expect(await server.mutation(api.social.claim, { postId })).toBeNull();
    expect(await server.mutation(api.social.cancel, { userId, postId })).toBe(true);
    const shaped = await server.query(api.social.get, { userId, postId });
    expect(shaped?.cancelled).toBe(true);
    expect(shaped?.deliveries[0].status).toBe("skipped");
  });

  it("marks a send lost past its lease as uncertain instead of sending it again", async () => {
    vi.useFakeTimers();
    try {
      const { t, server } = setup();
      const userId = await makeUser(server, "maker");
      const account = await connect(server, userId, "x", "brand");
      const postId = await server.mutation(api.social.create, { ...post, userId, accountIds: [account._id] });
      const claimed = await server.mutation(api.social.claim, { postId });
      vi.advanceTimersByTime(10 * 60_000);
      await t.mutation(internal.social.backstop, {});
      const row = await server.query(api.social.delivery, { deliveryId: claimed!.deliveries[0]._id });
      expect(row?.status).toBe("error");
      expect(row?.uncertain).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads stats often at first, then less, and X at most daily", () => {
    const sent = 0;
    const hour = 3_600_000;
    expect(nextMetricsAt("instagram", sent, 2 * hour)).toBe(3 * hour);
    expect(nextMetricsAt("instagram", sent, 3 * 24 * hour)).toBe(3 * 24 * hour + 6 * hour);
    expect(nextMetricsAt("x", sent, 2 * hour)).toBe(26 * hour);
    expect(nextMetricsAt("youtube", sent, 31 * 24 * hour)).toBeUndefined();
  });

  it("starts new Pages off and extra accounts off where the network can't repost", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    expect((await connect(server, userId, "instagram", "one")).defaultMode).toBe("post");
    expect((await connect(server, userId, "instagram", "two")).defaultMode).toBe("off");
    expect((await connect(server, userId, "x", "one")).defaultMode).toBe("post");
    expect((await connect(server, userId, "x", "two")).defaultMode).toBe("amplify");
  });

  it("supports Mastodon, Discord, Telegram, and Reddit, multiple accounts per network, and shared organisation accounts", async () => {
    const { server } = setup();
    const founder = await makeUser(server, "founder");
    const teammate = await makeUser(server, "teammate");
    const outsider = await makeUser(server, "outsider");

    const orgId = await server.mutation(api.organizations.create, {
      userId: founder,
      name: "Slopper Labs",
    });
    await server.mutation(api.organizations.addMember, {
      actorId: founder,
      organizationId: orgId,
      username: "teammate",
      role: "member",
    });

    // Connect multiple accounts on the same network (Discord) plus Mastodon, Telegram, and Reddit, shared with the org
    const discordAnnouncements = await server.mutation(api.accounts.connect, {
      userId: founder,
      provider: "discord",
      remoteId: "hook-1",
      handle: "#announcements",
      displayName: "#announcements",
      avatarUrl: null,
      sealedCredentials: "sealed",
      expiresAt: null,
      organizationId: orgId,
    });
    const discordChangelog = await server.mutation(api.accounts.connect, {
      userId: founder,
      provider: "discord",
      remoteId: "hook-2",
      handle: "#changelog",
      displayName: "#changelog",
      avatarUrl: null,
      sealedCredentials: "sealed",
      expiresAt: null,
      organizationId: orgId,
    });
    const mastodon = await server.mutation(api.accounts.connect, {
      userId: founder,
      provider: "mastodon",
      remoteId: "https://mastodon.social#1",
      handle: "slopper@mastodon.social",
      displayName: "Slopper",
      avatarUrl: null,
      sealedCredentials: "sealed",
      expiresAt: null,
      organizationId: orgId,
    });
    const telegram = await server.mutation(api.accounts.connect, {
      userId: founder,
      provider: "telegram",
      remoteId: "-1001234",
      handle: "sloppernews",
      displayName: "Slopper News",
      avatarUrl: null,
      sealedCredentials: "sealed",
      expiresAt: null,
      organizationId: orgId,
    });
    const reddit = await server.mutation(api.accounts.connect, {
      userId: founder,
      provider: "reddit",
      remoteId: "t5_slop",
      handle: "r/sideproject",
      displayName: "r/sideproject",
      avatarUrl: null,
      sealedCredentials: "sealed",
      expiresAt: null,
      organizationId: orgId,
    });

    // Teammate sees all shared organisation accounts
    const teammateAccounts = await server.query(api.accounts.list, { userId: teammate });
    expect(teammateAccounts.map((a) => a._id).sort()).toEqual(
      [discordAnnouncements._id, discordChangelog._id, mastodon._id, telegram._id, reddit._id].sort(),
    );

    // Teammate can post to multiple accounts on the same network (with per-account copy overrides) and across all new networks
    const postId = await server.mutation(api.social.create, {
      ...post,
      userId: teammate,
      text: "We just shipped v2.0!",
      overrides: {
        [discordChangelog._id]: "Changelog v2.0: new social networks and team organisations.",
      },
      accountIds: [discordAnnouncements._id, discordChangelog._id, mastodon._id, telegram._id, reddit._id],
    });
    const claimed = await server.mutation(api.social.claim, { postId });
    expect(claimed?.deliveries).toHaveLength(5);

    // Outsider cannot post with the organisation's shared accounts
    await expect(
      server.mutation(api.social.create, {
        ...post,
        userId: outsider,
        accountIds: [mastodon._id],
      }),
    ).rejects.toThrow("isn't yours");
  });
});
