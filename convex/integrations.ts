import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { productIdOf } from "./lib/shape";
import { integrationProviderValidator, revenueValidator, snapshotValidator } from "./schema";
import { addDays } from "../app/lib/dates";
import {
  addRevenue,
  INTEGRATIONS,
  SYNC_EVERY_MS,
  SYNC_LOCK_MS,
  TRACTION_DAYS,
  type Traction,
  type TractionSource,
} from "../app/lib/integrations";

/**
 * A product's connected sources and the numbers they report. The app server
 * holds the API keys' sealing key, so it runs every sync and writes the
 * results here; pages read them live.
 */

async function ownProduct(ctx: QueryCtx, userId: Id<"users">, slopId: Id<"slops">): Promise<Id<"slops">> {
  const slop = await ctx.db.get(slopId);
  if (!slop || slop.userId !== userId) throw new ConvexError("That slop isn't yours.");
  return productIdOf(slop);
}

async function ownIntegration(ctx: QueryCtx, userId: Id<"users">, rawId: string): Promise<Doc<"integrations">> {
  const id = ctx.db.normalizeId("integrations", rawId);
  const row = id ? await ctx.db.get(id) : null;
  if (!row || row.userId !== userId) throw new ConvexError("That connection isn't yours.");
  return row;
}

/** Connects a source, or replaces the product's existing one from the same provider. */
export const connect = mutation({
  args: {
    userId: v.id("users"),
    slopId: v.id("slops"),
    provider: integrationProviderValidator,
    settings: v.record(v.string(), v.string()),
    sealedSecret: v.union(v.string(), v.null()),
    public: v.boolean(),
  },
  handler: async (ctx, { userId, slopId, provider, settings, sealedSecret, public: visible }) => {
    await requireServer(ctx);
    const productId = await ownProduct(ctx, userId, slopId);
    const existing = (
      await ctx.db
        .query("integrations")
        .withIndex("by_product", (q) => q.eq("productId", productId))
        .collect()
    ).find((row) => row.provider === provider);
    if (existing) await removeWithMetrics(ctx, existing._id);
    return await ctx.db.insert("integrations", {
      productId,
      userId,
      provider,
      settings,
      sealedSecret,
      public: visible,
      status: "pending",
      error: null,
      syncedAt: null,
      syncingAt: null,
      cursor: null,
      live: null,
      snapshot: {},
    });
  },
});

async function removeWithMetrics(ctx: MutationCtx, id: Id<"integrations">) {
  const rows = await ctx.db
    .query("metrics")
    .withIndex("by_integration_date", (q) => q.eq("integrationId", id))
    .collect();
  for (const row of rows) await ctx.db.delete(row._id);
  await ctx.db.delete(id);
}

export const disconnect = mutation({
  args: { userId: v.id("users"), integrationId: v.string() },
  handler: async (ctx, { userId, integrationId }) => {
    await requireServer(ctx);
    const row = await ownIntegration(ctx, userId, integrationId);
    await removeWithMetrics(ctx, row._id);
  },
});

export const setPublic = mutation({
  args: { userId: v.id("users"), integrationId: v.string(), public: v.boolean() },
  handler: async (ctx, { userId, integrationId, public: visible }) => {
    await requireServer(ctx);
    const row = await ownIntegration(ctx, userId, integrationId);
    await ctx.db.patch(row._id, { public: visible });
  },
});

/**
 * Hands the server the product's sources that are due a sync, sealed keys
 * and all, and marks them as syncing so concurrent page views don't fetch
 * twice. `force` (the owner's "sync now") skips the freshness check, never
 * the lock.
 */
export const claim = mutation({
  args: { productId: v.id("slops"), force: v.optional(v.boolean()) },
  handler: async (ctx, { productId, force = false }): Promise<Doc<"integrations">[]> => {
    await requireServer(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();
    const due = rows.filter(
      (row) =>
        (row.syncingAt === null || now - row.syncingAt > SYNC_LOCK_MS) &&
        (force || row.syncedAt === null || now - row.syncedAt > SYNC_EVERY_MS),
    );
    for (const row of due) await ctx.db.patch(row._id, { syncingAt: now });
    return due;
  },
});

const dayValidator = v.object({
  date: v.string(),
  people: v.optional(v.number()),
  signups: v.optional(v.number()),
  revenue: v.optional(revenueValidator),
});

/**
 * Stores what a sync found. Window sources (analytics, Stripe) recount whole
 * days, so their rows are replaced; a wallet reports only payments it hasn't
 * seen, so they're added to the day's row.
 */
export const record = mutation({
  args: {
    integrationId: v.id("integrations"),
    outcome: v.union(
      v.object({
        ok: v.literal(true),
        merge: v.union(v.literal("replace"), v.literal("add")),
        days: v.array(dayValidator),
        live: v.union(v.number(), v.null()),
        snapshot: snapshotValidator,
        cursor: v.union(v.string(), v.null()),
      }),
      v.object({ ok: v.literal(false), error: v.string() }),
    ),
  },
  handler: async (ctx, { integrationId, outcome }) => {
    await requireServer(ctx);
    const row = await ctx.db.get(integrationId);
    // Disconnected while it synced: nothing to keep.
    if (!row) return;
    const now = Date.now();
    if (!outcome.ok) {
      await ctx.db.patch(row._id, { status: "error", error: outcome.error.slice(0, 300), syncingAt: null });
      return;
    }
    for (const day of outcome.days) {
      const existing = await ctx.db
        .query("metrics")
        .withIndex("by_integration_date", (q) => q.eq("integrationId", row._id).eq("date", day.date))
        .unique();
      if (!existing) {
        await ctx.db.insert("metrics", { ...day, integrationId: row._id, productId: row.productId });
      } else if (outcome.merge === "replace") {
        await ctx.db.replace(existing._id, { ...day, integrationId: row._id, productId: row.productId });
      } else {
        await ctx.db.patch(existing._id, {
          people: sum(existing.people, day.people),
          signups: sum(existing.signups, day.signups),
          revenue: day.revenue ? addRevenue({ ...existing.revenue }, day.revenue) : existing.revenue,
        });
      }
    }
    await ctx.db.patch(row._id, {
      status: "ok",
      error: null,
      syncedAt: now,
      syncingAt: null,
      cursor: outcome.cursor,
      live: outcome.live === null ? null : { people: outcome.live, at: now },
      snapshot: outcome.snapshot,
    });
  },
});

function sum(a: number | undefined, b: number | undefined): number | undefined {
  return a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
}

/** The product's sources for its owner's settings: everything but the sealed key. */
export const listForOwner = query({
  args: { userId: v.id("users"), slopId: v.id("slops") },
  handler: async (ctx, { userId, slopId }) => {
    await requireServer(ctx);
    const productId = await ownProduct(ctx, userId, slopId);
    const rows = await ctx.db
      .query("integrations")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();
    return rows.map((row) => ({
      id: row._id,
      provider: row.provider,
      settings: row.settings,
      public: row.public,
      status: row.status,
      error: row.error,
      syncedAt: row.syncedAt,
    }));
  },
});

/**
 * A product's traction for its page: its sources and the last 90 days of
 * their numbers. Visitors see public sources only; the owner sees all, with
 * errors. Settings and keys never leave, except a wallet address, which is
 * public on its chain anyway.
 */
export async function tractionFor(
  ctx: QueryCtx,
  productId: Id<"slops">,
  isOwner: boolean,
  today: string,
): Promise<Traction> {
  const rows = (
    await ctx.db
      .query("integrations")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect()
  )
    // A failed sync keeps the last numbers up; only the owner sees the error.
    .filter((row) => isOwner || (row.public && row.syncedAt !== null));
  if (rows.length === 0) return { sources: [], days: [] };
  const shown = new Set(rows.map((row) => row._id));
  const since = addDays(today, -(TRACTION_DAYS - 1));
  const metrics = await ctx.db
    .query("metrics")
    .withIndex("by_product_date", (q) => q.eq("productId", productId).gte("date", since))
    .collect();
  return {
    sources: rows.map((row): TractionSource => ({
      id: row._id,
      provider: row.provider,
      kind: INTEGRATIONS[row.provider].kind,
      label: row.provider === "solana" ? (row.settings.wallet ?? null) : null,
      public: row.public,
      status: row.status,
      error: isOwner ? row.error : null,
      syncedAt: row.syncedAt,
      live: row.live,
      snapshot: row.snapshot,
    })),
    days: metrics
      .filter((row) => shown.has(row.integrationId))
      .map((row) => ({
        sourceId: row.integrationId,
        date: row.date,
        people: row.people,
        signups: row.signups,
        revenue: row.revenue,
      })),
  };
}
