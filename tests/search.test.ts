// @vitest-environment edge-runtime
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { EMBEDDING_MODEL } from "@convex/lib/embeddings";
import { CATEGORIES, categoryFilter, categoryIds } from "~/lib/model";
import { embeddingText, fuseRankings, normalizeQuery } from "~/lib/search";
import { parseCursor, parseWallView, wallHref } from "~/lib/wall";
import { fakeEmbedding } from "../e2e/fake-embeddings.ts";
import { convexApp } from "./convexApp";

function setup() {
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}

type Test = ReturnType<typeof setup>["t"];
type Server = ReturnType<typeof setup>["server"];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

interface SlopFields {
  name: string;
  tagline?: string;
  description?: string;
  category?: string;
  madeWith?: string[];
}

function slopInput({
  name,
  tagline = "Made for the tests",
  description = "",
  category = "games",
  madeWith = [],
}: SlopFields) {
  return {
    name,
    tagline,
    description,
    category,
    links: [{ kind: "website" as const, url: "https://example.com/" }],
    screenshots: [],
    madeWith,
  };
}

async function ship(server: Server, userId: Id<"users">, fields: SlopFields): Promise<Id<"slops">> {
  const { slopId } = await server.mutation(api.slops.create, {
    userId,
    input: slopInput(fields),
    launchNote: "Day 1",
  });
  return slopId;
}

/** The fake OpenRouter: answers embeddings with `fakeEmbedding` and records what it was sent. */
function fakeEmbeddings() {
  vi.stubEnv("OPENROUTER_API_KEY", "or_test");
  const requests: { url: string; authorization: string | null; model: string; input: string[] }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { model: string; input: string[] };
    requests.push({
      url: input instanceof Request ? input.url : input.toString(),
      authorization: new Headers(init?.headers).get("authorization"),
      ...body,
    });
    return Response.json({
      data: body.input.map((text, index) => ({ object: "embedding", index, embedding: fakeEmbedding(text) })),
    });
  });
  return requests;
}

async function embedAll(t: Test) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function names(server: Server, query: string, categories: string[] = [], asUser?: Id<"users">) {
  const items = await server.action(api.search.find, { query, categories, asUser });
  if (items === null) throw new Error("Search budget unexpectedly spent.");
  return items.map((item) => item.slop.name);
}

describe("search helpers", () => {
  it("reads a query trimmed, single-spaced and at most 16 words", () => {
    expect(normalizeQuery("  budget \n tracker  ")).toBe("budget tracker");
    expect(normalizeQuery("   ")).toBe("");
    const words = Array.from({ length: 20 }, (_, n) => `w${n}`);
    expect(normalizeQuery(words.join(" ")).split(" ")).toHaveLength(16);
    expect(normalizeQuery("x".repeat(300))).toHaveLength(100);
  });

  it("ranks what several rankings agree on above one ranking's favourite", () => {
    const fused = fuseRankings([
      { ids: ["solo", "both"], weight: 1 },
      { ids: ["other", "both"], weight: 1 },
    ]);
    expect(fused[0]).toBe("both");
    // Weight breaks the tie between two first places.
    expect(
      fuseRankings([
        { ids: ["tagline"], weight: 2 },
        { ids: ["name"], weight: 3 },
      ]),
    ).toEqual(["name", "tagline"]);
    // Equal scores keep the order they were first seen in.
    expect(
      fuseRankings([
        { ids: ["a"], weight: 1 },
        { ids: ["b"], weight: 1 },
      ]),
    ).toEqual(["a", "b"]);
  });

  it("embeds what a slop is and what it's for", () => {
    expect(
      embeddingText({
        name: "Penny Jar",
        tagline: "Track every expense",
        description: "  Snap a receipt.  ",
        category: "money",
        madeWith: ["Flutter", "Claude"],
      }),
    ).toBe("Penny Jar: Track every expense\nCategory: Money\nMade with Flutter, Claude\nSnap a receipt.");
  });

  it("keeps real categories once each, and treats all of them as no filter", () => {
    expect(categoryIds(["ai", "nope", "games", "ai"])).toEqual(["games", "ai"]);
    expect(categoryFilter(["ai"])).toEqual(["ai"]);
    expect(categoryFilter(CATEGORIES.map((category) => category.id))).toEqual([]);
  });

  it("keeps the wall's filters and search in the URL", () => {
    const view = parseWallView(
      new URLSearchParams("q=  budget  app&category=ai&category=games&category=nope&sort=hot"),
    );
    expect(view).toEqual({ query: "budget app", categories: ["games", "ai"], sort: "hot" });
    expect(wallHref(view)).toBe("/wall?q=budget+app&category=games&category=ai&sort=hot");
    expect(parseWallView(new URLSearchParams(wallHref(view).split("?")[1]))).toEqual(view);
    expect(wallHref({ query: "", categories: [], sort: "new" })).toBe("/wall");
    expect(wallHref({ query: "", categories: ["ai"], sort: "new" }, 1234.5)).toBe("/wall?category=ai&cursor=1234.5");
    expect(parseCursor(new URLSearchParams("cursor=1234.5"))).toBe(1234.5);
    expect(parseCursor(new URLSearchParams("cursor=soon"))).toBeNull();
    expect(parseCursor(new URLSearchParams(""))).toBeNull();
  });
});

describe("the wall's categories", () => {
  async function wall(t: Test) {
    const server = t.withIdentity({ subject: "server" });
    const maker = await makeUser(server, "maker");
    const ids: Record<string, Id<"slops">> = {};
    for (const [name, category] of [
      ["Game one", "games"],
      ["Bot one", "ai"],
      ["Song one", "music"],
      ["Game two", "games"],
      ["Bot two", "ai"],
    ] as const) {
      ids[name] = await ship(server, maker, { name, category });
    }
    return { server, ids };
  }

  async function page(server: Server, categories: string[], before: number | null, limit: number) {
    const result = await server.query(api.slops.recent, { categories, before, limit });
    return { names: result.items.map((item) => item.slop.name), cursor: result.cursor };
  }

  it("shows any of several categories, newest first, a page at a time", async () => {
    const { server } = await wall(setup().t);
    const first = await page(server, ["games", "ai"], null, 3);
    expect(first.names).toEqual(["Bot two", "Game two", "Bot one"]);
    expect(first.cursor).not.toBeNull();
    const second = await page(server, ["games", "ai"], first.cursor, 3);
    expect(second).toEqual({ names: ["Game one"], cursor: null });
  });

  it("shows everything with no categories, or all of them, and repeats none", async () => {
    const { server } = await wall(setup().t);
    const everything = ["Bot two", "Game two", "Song one", "Bot one", "Game one"];
    expect((await page(server, [], null, 24)).names).toEqual(everything);
    expect(
      (
        await page(
          server,
          CATEGORIES.map((category) => category.id),
          null,
          24,
        )
      ).names,
    ).toEqual(everything);
    expect((await page(server, ["music", "music", "nope"], null, 24)).names).toEqual(["Song one"]);
  });

  it("ranks sticking slops from the picked categories only, never hidden ones", async () => {
    const { t } = setup();
    const { server, ids } = await wall(t);
    await t.run((ctx) => ctx.db.patch(ids["Bot two"], { hidden: true }));
    const items = await server.query(api.slops.hot, { since: 0, categories: ["ai", "music"], limit: 48 });
    expect(items.map((item) => item.slop.name).sort()).toEqual(["Bot one", "Song one"]);
  });
});

describe("search by words", () => {
  it("ranks a slop matching in its name and tagline above one matching only its description", async () => {
    const { server } = setup();
    const maker = await makeUser(server, "maker");
    await ship(server, maker, { name: "Notes", description: "Has a maze hidden in the settings." });
    await ship(server, maker, { name: "Marble Maze", tagline: "A maze you tilt" });
    await ship(server, maker, { name: "Weather", tagline: "Rain or shine" });
    expect(await names(server, "maze")).toEqual(["Marble Maze", "Notes"]);
  });

  it("matches the last word as a prefix, as people type", async () => {
    const { server } = setup();
    const maker = await makeUser(server, "maker");
    await ship(server, maker, { name: "Marble Maze" });
    expect(await names(server, "marb")).toEqual(["Marble Maze"]);
  });

  it("only searches the picked categories", async () => {
    const { server } = setup();
    const maker = await makeUser(server, "maker");
    await ship(server, maker, { name: "Maze Game", category: "games" });
    await ship(server, maker, { name: "Maze Bot", category: "ai" });
    await ship(server, maker, { name: "Maze Song", category: "music" });
    expect((await names(server, "maze", ["games", "music"])).sort()).toEqual(["Maze Game", "Maze Song"]);
  });

  it("never shows hidden slops, even to their maker, and NSFW ones only to people who opted in", async () => {
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const reader = await makeUser(server, "reader");
    const hidden = await ship(server, maker, { name: "Hidden Maze" });
    const nsfw = await ship(server, maker, { name: "Spicy Maze" });
    await ship(server, maker, { name: "Plain Maze" });
    await t.run((ctx) => ctx.db.patch(hidden, { hidden: true }));
    await t.run((ctx) => ctx.db.patch(nsfw, { nsfw: true }));

    expect(await names(server, "maze")).toEqual(["Plain Maze"]);
    expect(await names(server, "maze", [], reader)).toEqual(["Plain Maze"]);
    expect((await names(server, "maze", [], maker)).sort()).toEqual(["Plain Maze", "Spicy Maze"]);
    await t.run((ctx) => ctx.db.patch(reader, { showNsfw: true }));
    const opted = await server.action(api.search.find, { query: "maze", asUser: reader });
    if (opted === null) throw new Error("Search budget unexpectedly spent.");
    expect(opted.map((item) => item.slop.name).sort()).toEqual(["Plain Maze", "Spicy Maze"]);
    // Public shapes only: what Convex keeps to itself never leaves.
    expect(opted[0].slop).not.toHaveProperty("downvotes");
    expect(opted[0].slop).not.toHaveProperty("crosspost");
    expect(opted[0].slop).not.toHaveProperty("embeddingId");
  });

  it("is for the app server, and an empty query finds nothing", async () => {
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    await ship(server, maker, { name: "Marble Maze" });
    await expect(t.action(api.search.find, { query: "maze" })).rejects.toThrow("Only the Slopper server");
    await expect(t.withIdentity({ subject: maker }).action(api.search.find, { query: "maze" })).rejects.toThrow(
      "Only the Slopper server",
    );
    expect(await names(server, "   ")).toEqual([]);
  });
});

describe("search by meaning", () => {
  it("stops a signed-in account before more model, vector or word searches, then resets next hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    const { t, server } = setup();
    const reader = await makeUser(server, "reader");
    await t.run((ctx) =>
      ctx.db.insert("rateLimits", { key: `search:${reader}`, window: Math.floor(Date.now() / 3_600_000), count: 119 }),
    );
    const requests = fakeEmbeddings();

    expect(await server.action(api.search.find, { query: "last allowed", asUser: reader })).toEqual([]);

    expect(requests).toHaveLength(1);
    expect(await server.action(api.search.find, { query: "one more", asUser: reader })).toBeNull();
    expect(requests).toHaveLength(1);
    // Disabling embeddings must not bypass the account's search-work budget.
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await server.action(api.search.find, { query: "words only", asUser: reader })).toBeNull();
    expect(await server.action(api.search.find, { query: "   ", asUser: reader })).toEqual([]);

    vi.setSystemTime(new Date("2026-10-27T13:00:00Z"));
    expect(await server.action(api.search.find, { query: "fresh hour", asUser: reader })).toEqual([]);
  });

  it("keeps accounts independent and counts failed embedding attempts", async () => {
    const { t, server } = setup();
    const first = await makeUser(server, "first");
    await t.run((ctx) =>
      ctx.db.insert("rateLimits", { key: `search:${first}`, window: Math.floor(Date.now() / 3_600_000), count: 119 }),
    );
    const second = await makeUser(server, "second");
    vi.stubEnv("OPENROUTER_API_KEY", "or_test");
    const provider = vi.fn(async () => new Response("overloaded", { status: 529 }));
    vi.stubGlobal("fetch", provider);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await server.action(api.search.find, { query: "last allowed", asUser: first })).toEqual([]);

    expect(await server.action(api.search.find, { query: "one more", asUser: first })).toBeNull();
    expect(provider).toHaveBeenCalledTimes(1);
    expect(await server.action(api.search.find, { query: "my first", asUser: second })).toEqual([]);
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("embeds each launch through OpenRouter and finds it by meaning", async () => {
    vi.useFakeTimers();
    const requests = fakeEmbeddings();
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    await ship(server, maker, { name: "Penny Jar", tagline: "Track every expense", category: "money" });
    await ship(server, maker, { name: "Marble Maze", tagline: "Tilt to roll" });
    await embedAll(t);

    expect(requests[0]).toMatchObject({
      url: "https://openrouter.ai/api/v1/embeddings",
      authorization: "Bearer or_test",
      model: EMBEDDING_MODEL,
      input: ["Penny Jar: Track every expense\nCategory: Money"],
    });
    // No word in common with "budget", and nothing unrelated sneaks in.
    expect(await names(server, "budget")).toEqual(["Penny Jar"]);
    expect(await names(server, "puzzle")).toEqual(["Marble Maze"]);
    expect(await names(server, "budget", ["games"])).toEqual([]);
  });

  it("puts a slop matching words and meaning above one matching either", async () => {
    vi.useFakeTimers();
    fakeEmbeddings();
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    await ship(server, maker, { name: "Spend Less", tagline: "Weekly challenges", category: "money" });
    await ship(server, maker, { name: "Budget Planner", tagline: "Plan the month ahead", category: "money" });
    await ship(server, maker, { name: "Budget Beats", tagline: "Free synth loops", category: "music" });
    await embedAll(t);
    const ranked = await names(server, "budget");
    expect(ranked[0]).toBe("Budget Planner");
    expect(ranked.sort()).toEqual(["Budget Beats", "Budget Planner", "Spend Less"]);
  });

  it("embeds again when an edit changes the text, and forgets a deleted slop's vector", async () => {
    vi.useFakeTimers();
    const requests = fakeEmbeddings();
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const slopId = await ship(server, maker, { name: "Leafy", tagline: "Water your plants", category: "health" });
    await embedAll(t);
    expect(await names(server, "garden")).toEqual(["Leafy"]);

    // Same text: nothing to embed.
    await server.mutation(api.slops.edit, {
      userId: maker,
      slopId,
      input: slopInput({ name: "Leafy", tagline: "Water your plants", category: "health" }),
    });
    await embedAll(t);
    expect(requests).toHaveLength(2);

    await server.mutation(api.slops.edit, {
      userId: maker,
      slopId,
      input: slopInput({ name: "Leafy", tagline: "Lo-fi beats to study to", category: "music" }),
    });
    await embedAll(t);
    expect(requests).toHaveLength(3);
    expect(await names(server, "garden")).toEqual([]);
    expect(await names(server, "song", ["music"])).toEqual(["Leafy"]);
    const embedding = await t.run(async (ctx) => {
      const slop = await ctx.db.get(slopId);
      return slop?.embeddingId ? await ctx.db.get(slop.embeddingId) : null;
    });
    expect(embedding?.category).toBe("music");

    await server.mutation(api.slops.remove, { slopId, byUserId: maker });
    expect(await t.run(async (ctx) => await ctx.db.query("slopEmbeddings").collect())).toEqual([]);
  });

  it("skips an embedding whose slop changed while it was made", async () => {
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const slopId = await ship(server, maker, { name: "Leafy", tagline: "Water your plants" });
    await t.mutation(internal.search.saveEmbeddings, {
      rows: [{ slopId, text: "Leafy: an older tagline", embedding: fakeEmbedding("plants") }],
    });
    expect(await t.run(async (ctx) => await ctx.db.query("slopEmbeddings").collect())).toEqual([]);
    expect(await t.run(async (ctx) => (await ctx.db.get(slopId))?.embeddingId ?? null)).toBeNull();
  });

  it("matches words only when embeddings are off or the provider fails", async () => {
    const { server } = setup();
    const maker = await makeUser(server, "maker");
    await ship(server, maker, { name: "Penny Jar", tagline: "Track every expense", category: "money" });
    expect(await names(server, "penny")).toEqual(["Penny Jar"]);

    vi.stubEnv("OPENROUTER_API_KEY", "or_test");
    vi.stubGlobal("fetch", async () => new Response("overloaded", { status: 529 }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await names(server, "penny")).toEqual(["Penny Jar"]);
    expect(logged).toHaveBeenCalledWith("Couldn't embed a search, so it matched words only", expect.any(Error));
  });

  it("backfills slops launched before embeddings were on, in batches", async () => {
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    await ship(server, maker, { name: "Penny Jar", tagline: "Track every expense", category: "money" });
    await ship(server, maker, { name: "Marble Maze", tagline: "Tilt to roll" });
    await expect(t.action(internal.search.backfill, {})).rejects.toThrow("OPENROUTER_API_KEY isn't set");

    vi.useFakeTimers();
    const requests = fakeEmbeddings();
    await t.action(internal.search.backfill, {});
    await embedAll(t);
    expect(requests).toHaveLength(1);
    expect(requests[0].input).toHaveLength(2);

    // Everything's current: a second run embeds nothing.
    await t.action(internal.search.backfill, {});
    await embedAll(t);
    expect(requests).toHaveLength(1);
    expect(await names(server, "budget")).toEqual(["Penny Jar"]);
  });
});
