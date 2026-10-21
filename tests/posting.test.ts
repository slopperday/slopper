import { describe, expect, it, vi } from "vite-plus/test";
import type { Id } from "@convex/_generated/dataModel";
import {
  composeFor,
  graphemeLength,
  markdownToPlain,
  type PostContent,
  shareIntents,
  xWeightedLength,
} from "~/lib/compose";
import type { SocialProvider } from "~/lib/model";
import {
  type ConnectedAccount,
  escapeLittleText,
  linkFacets,
  type PublishedPost,
  type SocialAdapter,
  SocialError,
} from "~/.server/social/adapters";
import { buildPostContent, planCrossposts, runCrossposts } from "~/.server/social/crosspost";

const content = (text: string): PostContent => ({
  text,
  url: "https://slopper.day/@ifiokjr/tiltmaze",
  title: "TiltMaze",
  description: "Tilt to play",
  imageUrl: null,
});

describe("composing posts", () => {
  it("counts X's weights: URLs are 23, wide characters 2", () => {
    expect(xWeightedLength("hello")).toBe(5);
    expect(xWeightedLength("https://example.com/a/very/long/path")).toBe(23);
    expect(xWeightedLength("日本")).toBe(4);
    expect(xWeightedLength("hi 🔥")).toBe(5);
  });

  it("keeps the link and fits X's 280 budget", () => {
    const text = composeFor("x", content("word ".repeat(200)));
    expect(text.endsWith("\n\nhttps://slopper.day/@ifiokjr/tiltmaze")).toBe(true);
    expect(xWeightedLength(text)).toBeLessThanOrEqual(280);
    expect(text).toContain("…");
  });

  it("fits Bluesky's 300 graphemes, emoji included", () => {
    expect(graphemeLength(composeFor("bluesky", content("🥣".repeat(400))))).toBeLessThanOrEqual(300);
    expect(composeFor("bluesky", content("Shipped!"))).toBe("Shipped!\n\nhttps://slopper.day/@ifiokjr/tiltmaze");
  });

  it("turns Markdown into plain text with link targets", () => {
    expect(markdownToPlain("## Hi\n**Bold** and [docs](https://x.dev) `code`")).toBe(
      "Hi\nBold and docs (https://x.dev) code",
    );
  });

  it("escapes LinkedIn's little-text characters", () => {
    expect(escapeLittleText("Day #3 (beta) @you [x] *wow* _ok_ ~")).toBe(
      "Day \\#3 \\(beta\\) \\@you \\[x\\] \\*wow\\* \\_ok\\_ \\~",
    );
  });

  it("builds Bluesky link facets from UTF-8 byte offsets", () => {
    const [facet] = linkFacets("🥣 https://slopper.day/x");
    expect(facet.index).toEqual({ byteStart: 5, byteEnd: 26 });
  });

  it("encodes share intents", () => {
    const intents = shareIntents("A & B", "https://slopper.day/@a/b");
    expect(intents.x).toContain("text=A%20%26%20B");
    expect(intents.linkedin).toBe(
      `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent("A & B https://slopper.day/@a/b")}`,
    );
  });

  it("announces relaunches with their label and goal day", () => {
    const post = buildPostContent(
      {
        name: "TiltMaze",
        tagline: "Tilt to play",
        slug: "tiltmaze-ios-beta",
        goalDay: 3,
        goalLength: 30,
        launchLabel: "iOS beta",
        screenshots: ["https://cdn/shot.png"],
      },
      { kind: "launch", body: "On TestFlight now" },
      "ifiokjr",
    );
    expect(post.text).toBe("Day 3/30 · Just slopped TiltMaze (iOS beta): Tilt to play\n\nOn TestFlight now");
    expect(post.title).toBe("TiltMaze · iOS beta");
    expect(post.imageUrl).toBe("https://cdn/shot.png");
  });

  it("names the version, the feature and how a field test went", () => {
    const slop = {
      name: "TiltMaze",
      tagline: "Tilt to play",
      slug: "tiltmaze",
      goalDay: null,
      goalLength: null,
      launchLabel: null,
      screenshots: [],
    };
    const feature = buildPostContent(
      slop,
      { kind: "feature", body: "Build a maze.", version: "v1.3", details: { kind: "feature", name: "Level editor" } },
      "ifiokjr",
    );
    expect(feature.text).toBe("TiltMaze v1.3 · New feature: Level editor\n\nBuild a maze.");
    const field = buildPostContent(
      slop,
      { kind: "field", body: "3 got hooked.", details: { kind: "field", outcome: "mixed", who: "5 people" } },
      "ifiokjr",
    );
    expect(field.text).toBe("TiltMaze · Field test (mixed)\n\n3 got hooked.");
  });
});

function account(id: string, provider: SocialProvider, defaultMode: ConnectedAccount["defaultMode"]): ConnectedAccount {
  return {
    _id: id as Id<"accounts">,
    _creationTime: 0,
    userId: "user" as Id<"users">,
    provider,
    remoteId: `remote-${id}`,
    handle: id,
    displayName: id,
    avatarUrl: null,
    sealedCredentials: "",
    expiresAt: null,
    defaultMode,
  };
}

/**
 * Records calls. Publishing is refused, as a network refuses, for handles in
 * `failing`, and breaks some other way for handles in `broken`.
 */
function fakeAdapters(failing: ReadonlySet<string> = new Set(), broken: ReadonlySet<string> = new Set()) {
  const calls: string[] = [];
  const make = (provider: SocialProvider, canAmplify: boolean): SocialAdapter => ({
    publish(acct): Promise<PublishedPost> {
      calls.push(`publish:${acct.handle}`);
      if (failing.has(acct.handle)) return Promise.reject(new SocialError(`${acct.handle} is down`, 503));
      if (broken.has(acct.handle)) return Promise.reject(new TypeError("fetch failed"));
      return Promise.resolve({
        provider,
        remoteId: `post-${acct.handle}`,
        url: `https://${provider}.test/${acct.handle}`,
      });
    },
    ...(canAmplify
      ? {
          amplify(acct: ConnectedAccount, post: PublishedPost) {
            calls.push(`amplify:${acct.handle}->${post.remoteId}`);
            return Promise.resolve();
          },
        }
      : {}),
  });
  return { calls, adapters: { x: make("x", true), bluesky: make("bluesky", true), linkedin: make("linkedin", false) } };
}

describe("auto-posting", () => {
  it("posts first, then the personal account reposts the app's account", async () => {
    const plans = planCrossposts({ crosspost: {} }, [account("me", "x", "amplify"), account("app", "x", "post")]);
    expect(plans.map((plan) => plan.account.handle)).toEqual(["app", "me"]);
    const { calls, adapters } = fakeAdapters();
    const results = await runCrossposts(plans, content("hi"), adapters);
    expect(calls).toEqual(["publish:app", "amplify:me->post-app"]);
    expect(results.map((result) => result.status)).toEqual(["ok", "ok"]);
  });

  it("lets per-slop overrides beat account defaults", () => {
    const plans = planCrossposts({ crosspost: { a: "off", b: "post" } }, [
      account("a", "x", "post"),
      account("b", "bluesky", "off"),
    ]);
    expect(plans.map((plan) => [plan.account.handle, plan.mode])).toEqual([["b", "post"]]);
  });

  it("never lets one failing network stop the others, and words each failure plainly", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { adapters } = fakeAdapters(new Set(["refused"]), new Set(["glitch"]));
    const results = await runCrossposts(
      planCrossposts({ crosspost: {} }, [
        account("refused", "x", "post"),
        account("glitch", "linkedin", "post"),
        account("sky", "bluesky", "post"),
        account("fan", "x", "amplify"),
      ]),
      content("hi"),
      adapters,
    );
    expect(results.map((result) => [result.handle, result.status, result.message])).toEqual([
      ["refused", "error", "refused is down"],
      // Anything but a network's refusal stays out of the maker's sight; the logs have it.
      ["glitch", "error", "Something went wrong. Try again later."],
      ["sky", "ok", null],
      ["fan", "skipped", "No post on this network to repost."],
    ]);
    expect(logged).toHaveBeenCalledWith("Posting failed", expect.any(TypeError));
    logged.mockRestore();
  });

  it("skips LinkedIn reposts, which have no API", async () => {
    const { adapters } = fakeAdapters();
    const results = await runCrossposts(
      [
        { account: account("li", "linkedin", "post"), mode: "post" },
        { account: account("li2", "linkedin", "amplify"), mode: "amplify" },
      ],
      content("hi"),
      adapters,
    );
    expect(results.map((result) => result.status)).toEqual(["ok", "skipped"]);
  });
});
