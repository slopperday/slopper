import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { readerFor, requireServer } from "./lib/auth";
import { embeddingSettings, embedTexts } from "./lib/embeddings";
import { type CardItem, isVisibleTo, toCards } from "./lib/shape";
import { categoryFilter } from "../app/lib/model";
import {
  embeddingText,
  fuseRankings,
  normalizeQuery,
  type Ranking,
  SEARCH_LIMIT,
  SEARCHES_PER_HOUR,
} from "../app/lib/search";

/**
 * Search over slops, by words and by meaning. Full-text search ranks
 * matches in the name, tagline and description, each on its own (the last
 * word also matches as a prefix, so "tilt" finds TiltMaze). Vector search on
 * an embedding of the same text finds slops that mean what was asked
 * without sharing its words: "budget" finds an expense tracker. The
 * rankings merge into one (`fuseRankings`).
 *
 * Hidden slops never show, NSFW ones only to people who opted in (as on the
 * wall), and only card shapes leave. Each slop's embedding is made when it's
 * launched or its text changes; `backfill` embeds the rest.
 */

/**
 * Below this cosine similarity a slop is too far from the query to count:
 * text-embedding-3-small scores unrelated text under about 0.2.
 */
const MIN_SIMILARITY = 0.3;

const FIELDS = ["name", "tagline", "description"] as const;
type Field = (typeof FIELDS)[number];

/** Words in the name say the most about a slop, then the tagline's, then the description's. Meaning counts like a name. */
const WEIGHTS = { name: 3, tagline: 2, description: 1, meaning: 3 } as const;

/** Tries at embedding a slop before leaving it to `backfill`. */
const RETRIES = 3;
/** Slops per embeddings request while backfilling. */
const BACKFILL_BATCH = 64;

/** Visible slops whose `field` matches `query`, best first. */
async function wordMatches(
  ctx: QueryCtx,
  field: Field,
  query: string,
  category: string | null,
  limit: number,
): Promise<Doc<"slops">[]> {
  return await ctx.db
    .query("slops")
    .withSearchIndex(`search_${field}`, (q) => {
      const visible = q.search(field, query).eq("hidden", false);
      return category ? visible.eq("category", category) : visible;
    })
    .take(limit);
}

/** Embeddings of slops nearest in meaning to `query`, nearest first. Empty when embeddings are off. */
async function nearest(
  ctx: ActionCtx,
  query: string,
  categories: readonly string[],
  limit: number,
): Promise<Id<"slopEmbeddings">[]> {
  const settings = embeddingSettings();
  if (!settings) return [];
  let vector: number[];
  try {
    [vector] = await embedTexts(settings, [query]);
  } catch (error) {
    // Words still match: a provider outage costs searches their meaning, not their results.
    console.error("Couldn't embed a search, so it matched words only", error);
    return [];
  }
  const hits = await ctx.vectorSearch("slopEmbeddings", "by_embedding", {
    vector,
    limit,
    filter:
      categories.length > 0 ? (q) => q.or(...categories.map((category) => q.eq("category", category))) : undefined,
  });
  return hits.filter((hit) => hit._score >= MIN_SIMILARITY).map((hit) => hit._id);
}

/**
 * Slops matching `query` in any of `categories` (all when empty), best
 * first, as cards for `asUser`. The app server calls this for the wall and
 * for agents. Null means the account's hourly search budget is spent.
 */
export const find = action({
  args: {
    query: v.string(),
    categories: v.optional(v.array(v.string())),
    limit: v.optional(v.number()),
    asUser: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<CardItem[] | null> => {
    await requireServer(ctx);
    const query = normalizeQuery(args.query);
    if (!query) return [];

    // Reserve before any search work, including paid embedding attempts that fail.
    // Every signed-in surface shares this account budget; addresses are limited at HTTP entry points.
    if (
      args.asUser &&
      !(await ctx.runMutation(api.limits.hit, {
        key: `search:${args.asUser}`,
        limit: SEARCHES_PER_HOUR,
        windowMs: 3_600_000,
      }))
    )
      return null;

    const categories = categoryFilter(args.categories ?? []);
    const limit = Math.min(Math.max(1, Math.floor(args.limit ?? SEARCH_LIMIT)), SEARCH_LIMIT);
    const meaning = await nearest(ctx, query, categories, limit);
    return await ctx.runQuery(internal.search.results, { query, categories, meaning, limit, asUser: args.asUser });
  },
});

/** Ranks word matches and the nearest embeddings into one list of cards. */
export const results = internalQuery({
  args: {
    query: v.string(),
    categories: v.array(v.string()),
    /** Nearest first, already close enough to count. */
    meaning: v.array(v.id("slopEmbeddings")),
    limit: v.number(),
    asUser: v.optional(v.id("users")),
  },
  handler: async (ctx, { query, categories, meaning, limit, asUser }): Promise<CardItem[]> => {
    const reader = await readerFor(ctx, asUser);
    const found = new Map<Id<"slops">, Doc<"slops">>();
    const rankings: Ranking<Id<"slops">>[] = [];

    // A slop is in one category, so each category's matches are a ranking of their own, with its share of the results.
    const scopes = categories.length > 0 ? categories : [null];
    const share = Math.ceil(limit / scopes.length);
    for (const field of FIELDS) {
      for (const category of scopes) {
        const matches = await wordMatches(ctx, field, query, category, share);
        for (const slop of matches) found.set(slop._id, slop);
        rankings.push({ ids: matches.map((slop) => slop._id), weight: WEIGHTS[field] });
      }
    }

    const near: Id<"slops">[] = [];
    for (const embeddingId of meaning) {
      const slop = await ctx.db
        .query("slops")
        .withIndex("by_embedding", (q) => q.eq("embeddingId", embeddingId))
        .unique();
      if (!slop || slop.hidden || (categories.length > 0 && !categories.includes(slop.category))) continue;
      found.set(slop._id, slop);
      near.push(slop._id);
    }
    rankings.push({ ids: near, weight: WEIGHTS.meaning });

    const ranked = fuseRankings(rankings).flatMap((id) => found.get(id) ?? []);
    const visible = ranked.filter((slop) => isVisibleTo(slop, reader)).slice(0, limit);
    return await toCards(ctx, visible, reader);
  },
});

/** Embeds a slop's text soon after it's written, when embeddings are on. */
export async function scheduleEmbedding(ctx: MutationCtx, slopId: Id<"slops">): Promise<void> {
  if (embeddingSettings()) await ctx.scheduler.runAfter(0, internal.search.embed, { slopId, attempt: 1 });
}

/** The text a slop's embedding should be made from, or null when its embedding already is. */
async function textToEmbed(ctx: QueryCtx, slop: Doc<"slops">): Promise<string | null> {
  const text = embeddingText(slop);
  const current = slop.embeddingId ? await ctx.db.get(slop.embeddingId) : null;
  return current?.text === text ? null : text;
}

export const pendingText = internalQuery({
  args: { slopId: v.id("slops") },
  handler: async (ctx, { slopId }): Promise<string | null> => {
    const slop = await ctx.db.get(slopId);
    return slop ? await textToEmbed(ctx, slop) : null;
  },
});

/** One page of slops, with the text of each one whose embedding is missing or out of date. */
export const pendingPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, { cursor, numItems }) => {
    const page = await ctx.db.query("slops").paginate({ cursor, numItems });
    const items: { slopId: Id<"slops">; text: string }[] = [];
    for (const slop of page.page) {
      const text = await textToEmbed(ctx, slop);
      if (text !== null) items.push({ slopId: slop._id, text });
    }
    return { items, cursor: page.isDone ? null : page.continueCursor };
  },
});

/** Stores embeddings, skipping any slop whose text changed (or that went) while it was embedded. */
export const saveEmbeddings = internalMutation({
  args: { rows: v.array(v.object({ slopId: v.id("slops"), text: v.string(), embedding: v.array(v.float64()) })) },
  handler: async (ctx, { rows }) => {
    for (const { slopId, text, embedding } of rows) {
      const slop = await ctx.db.get(slopId);
      // The newer text has an embed of its own on the way.
      if (!slop || embeddingText(slop) !== text) continue;
      const row = { category: slop.category, text, embedding };
      const current = slop.embeddingId ? await ctx.db.get(slop.embeddingId) : null;
      if (current) await ctx.db.replace(current._id, row);
      else await ctx.db.patch(slopId, { embeddingId: await ctx.db.insert("slopEmbeddings", row) });
    }
  },
});

/** Embeds one slop's text, trying again a little later if the provider fails. */
export const embed = internalAction({
  args: { slopId: v.id("slops"), attempt: v.number() },
  handler: async (ctx, { slopId, attempt }) => {
    const settings = embeddingSettings();
    if (!settings) return;
    const text = await ctx.runQuery(internal.search.pendingText, { slopId });
    if (text === null) return;
    try {
      const [embedding] = await embedTexts(settings, [text]);
      await ctx.runMutation(internal.search.saveEmbeddings, { rows: [{ slopId, text, embedding }] });
    } catch (error) {
      console.error(`Couldn't embed slop ${slopId} (attempt ${attempt})`, error);
      // Past the last try, `backfill` picks it up.
      if (attempt < RETRIES) {
        await ctx.scheduler.runAfter(attempt * 60_000, internal.search.embed, { slopId, attempt: attempt + 1 });
      }
    }
  },
});

/**
 * Embeds every slop whose embedding is missing or out of date, a batch per
 * run, then schedules the next. Run it once after turning embeddings on:
 * `npx convex run --prod search:backfill`. A failure stops it; run it again
 * and it carries on, skipping slops already done.
 */
export const backfill = internalAction({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor = null }) => {
    const settings = embeddingSettings();
    if (!settings) throw new Error("OPENROUTER_API_KEY isn't set on Convex, so nothing can be embedded.");
    const page = await ctx.runQuery(internal.search.pendingPage, { cursor, numItems: BACKFILL_BATCH });
    if (page.items.length > 0) {
      const vectors = await embedTexts(
        settings,
        page.items.map((item) => item.text),
      );
      await ctx.runMutation(internal.search.saveEmbeddings, {
        rows: page.items.map((item, index) => ({ ...item, embedding: vectors[index] })),
      });
    }
    if (page.cursor !== null) await ctx.scheduler.runAfter(0, internal.search.backfill, { cursor: page.cursor });
  },
});
