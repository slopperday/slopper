// @vitest-environment edge-runtime
import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { cleanTags, exactTag, matchTags, tagKind, tagOptions } from "~/lib/tags";
import { convexApp } from "./convexApp";
import { checkedLaunch } from "./launchFixtures";

describe("made-with tags", () => {
  it("spells known tags our way, splits commas and drops repeats in any case", () => {
    expect(cleanTags(["claude code, opus 5.5", "Claude Opus 5.5", " my  thing ", "", "MY THING"])).toEqual([
      "Claude Code",
      "Opus 5.5",
      "my thing",
    ]);
    expect(tagKind("Opus 5.5")).toBe("model");
    expect(tagKind("claude-code")).toBe("harness");
    expect(tagKind("Pixi")).toBe("other");
  });

  it("ranks by use, and keeps people's tags out until a few slops use them", () => {
    const options = tagOptions([
      { name: "Claude Code", uses: 5 },
      { name: "Pixi", uses: 3 },
      { name: "typo", uses: 1 },
    ]);
    expect(options.slice(0, 2).map((option) => option.name)).toEqual(["Claude Code", "Pixi"]);
    expect(options.find((option) => option.name === "Pixi")?.kind).toBe("other");
    expect(options.some((option) => option.name === "typo")).toBe(false);
  });

  it("matches what's typed and picks a tag by itself only once nothing longer fits", () => {
    const options = tagOptions([]);
    expect(matchTags(options, "opus", [])[0].name).toBe("Opus 5.5");
    expect(matchTags(options, "opus", ["Opus 5.5"]).some((option) => option.name === "Opus 5.5")).toBe(false);
    expect(exactTag(options, "claude code", [])?.name).toBe("Claude Code");
    // "Opus 5.5" might be next.
    expect(exactTag(options, "Opus 5", [])).toBeNull();
    expect(exactTag(options, "Opus 5.5", [])?.name).toBe("Opus 5.5");
    // An alias of the same tag doesn't hold it back.
    expect(exactTag(options, "codex", [])?.name).toBe("Codex");
    expect(exactTag(options, "Claude Code", ["Claude Code"])).toBeNull();
  });
});

describe("tag counts", () => {
  const input = {
    name: "TiltMaze",
    tagline: "Tilt to play",
    description: "",
    category: "games",
    links: [{ kind: "website" as const, url: "https://tiltmaze.app/" }],
    screenshots: [],
  };

  async function setup() {
    const t = convexApp();
    const server = t.withIdentity({ subject: "server" });
    const { userId } = await server.mutation(api.users.upsertFromIdentity, {
      provider: "dev",
      providerId: "ifiok",
      preferredUsername: "ifiok",
      displayName: "ifiok",
      avatarUrl: null,
      timeZone: "UTC",
    });
    return { t, server, userId };
  }

  it("counts tags as slops launch, change and go, spelled as first used", async () => {
    const { t, server, userId } = await setup();
    const counts = async () =>
      Object.fromEntries((await t.query(api.tags.popular, {})).map(({ name, uses }) => [name, uses]));
    const ship = async (madeWith: string[]) =>
      await checkedLaunch(server, {
        userId,
        input: { ...input, madeWith },
        launchNote: "",
      });
    const first = await ship(["Claude Code", "Pixi"]);
    await ship(["claude code", "pixi"]);
    expect(await counts()).toEqual({ "Claude Code": 2, Pixi: 2 });
    const second = await t.run(async (ctx) => await ctx.db.query("slops").order("desc").first());
    expect(second?.madeWith).toEqual(["Claude Code", "Pixi"]);

    await server.mutation(api.slops.edit, {
      userId,
      slopId: first.slopId,
      input: { ...input, madeWith: ["Claude Code", "Opus 5.5"] },
    });
    expect(await counts()).toEqual({ "Claude Code": 2, "Opus 5.5": 1, Pixi: 1 });

    await server.mutation(api.slops.remove, { slopId: first.slopId, byUserId: userId });
    // Gone from popular once nothing uses them.
    expect(await counts()).toEqual({ "Claude Code": 1, Pixi: 1 });
  });

  it("backfills counts and spellings for slops from before tags were counted", async () => {
    const { t, server, userId } = await setup();
    const { slopId } = await checkedLaunch(server, {
      userId,
      input: { ...input, madeWith: [] },
      launchNote: "",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(slopId as Id<"slops">, { madeWith: ["claude code", "Flutter", "flutter"] });
    });
    expect(await t.mutation(internal.tags.backfill, {})).toEqual({ slops: 1, tags: 2 });
    expect((await t.run(async (ctx) => await ctx.db.get(slopId)))?.madeWith).toEqual(["Claude Code", "Flutter"]);
    // Once counted, it leaves them alone.
    expect(await t.mutation(internal.tags.backfill, {})).toEqual({ slops: 0, tags: 0 });
  });
});
