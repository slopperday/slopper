import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { isPublication } from "./lib/media";
import { requireMayJudge, requirePermission } from "./lib/permissions";
import { consume } from "./lib/rate";
import { logStaffAction } from "./lib/staffLog";
import { checkVerdictValidator, flagDecisionValidator } from "./schema";
import { FLAGS_TO_BLUR } from "../app/lib/model";

/**
 * Keeping Slopper safe for work. Three things pull a slop out of
 * circulation: the automated content check (run by the app server), flags
 * from signed-in people, and moderators. None of them undoes itself; only a
 * moderator puts a slop back.
 */

async function openFlags(ctx: QueryCtx, slopId: Id<"slops">): Promise<Doc<"reports">[]> {
  return await ctx.db
    .query("reports")
    .withIndex("by_slop", (q) => q.eq("slopId", slopId))
    .collect();
}

async function clearFlags(ctx: MutationCtx, slopId: Id<"slops">): Promise<void> {
  for (const row of await openFlags(ctx, slopId)) await ctx.db.delete(row._id);
}

/**
 * Why auto-posting is held for this slop, or null when it may post. A slop
 * posts only once it has passed the content check, with no open flags.
 */
export function autopostHold(slop: Doc<"slops">, flags: number): string | null {
  if (slop.hidden) return "it's waiting for a moderator";
  if (slop.nsfw) return "it's marked NSFW";
  if (flags > 0) return "someone flagged it";
  if (!slop.check) return "it hasn't been cleared yet";
  if (slop.check.verdict !== "ok") return "it wasn't cleared for posting";
  return null;
}

export const autopostHoldFor = query({
  args: { slopId: v.id("slops") },
  handler: async (ctx, { slopId }): Promise<string | null> => {
    await requireServer(ctx);
    const slop = await ctx.db.get(slopId);
    if (!slop) return "it's gone";
    return autopostHold(slop, (await openFlags(ctx, slopId)).length);
  },
});

/**
 * Records a content check. For the slop itself, "mature" blurs it and
 * "blocked" also hides it. For an update, "mature" only raises a flag and
 * "blocked" hides the slop. Anything but "ok" lands in the moderation queue.
 */
async function recordCheck(
  ctx: MutationCtx,
  slopId: Id<"slops">,
  scope: "slop" | "update",
  verdict: Infer<typeof checkVerdictValidator>,
  reason: string,
): Promise<void> {
  const note = reason.trim().slice(0, 300) || "No reason given";
  if (scope === "slop") {
    await ctx.db.patch(slopId, {
      check: { verdict, reason: note, checkedAt: Date.now() },
      ...(verdict === "ok" ? {} : { nsfw: true }),
      ...(verdict === "blocked" ? { hidden: true } : {}),
    });
  } else if (verdict === "blocked") {
    await ctx.db.patch(slopId, { hidden: true });
  }
  if (verdict !== "ok") {
    const what = scope === "slop" ? "Content check" : "Content check on an update";
    await ctx.db.insert("reports", { slopId, reporterId: null, reason: `${what} (${verdict}): ${note}` });
  }
}

export const applyCheck = mutation({
  args: {
    slopId: v.id("slops"),
    scope: v.union(v.literal("slop"), v.literal("update")),
    verdict: checkVerdictValidator,
    reason: v.string(),
  },
  handler: async (ctx, { slopId, scope, verdict, reason }) => {
    await requireServer(ctx);
    if (await ctx.db.get(slopId)) await recordCheck(ctx, slopId, scope, verdict, reason);
  },
});

/**
 * A slop that newly shows a screenshot (or publication) the upload check
 * found mature gets that verdict too: blurred, queued for a moderator, never
 * auto-posted. Uploads it already showed are skipped, so a moderator's
 * "looks fine" survives later edits. Returns whether it blurred the slop.
 */
export async function checkScreenshots(
  ctx: MutationCtx,
  slopId: Id<"slops">,
  screenshots: readonly Id<"media">[],
  alreadyShown: readonly Id<"media">[] = [],
): Promise<boolean> {
  const reasons: string[] = [];
  for (const id of screenshots) {
    if (alreadyShown.includes(id)) continue;
    const media = await ctx.db.get(id);
    if (media?.check?.verdict === "mature") {
      reasons.push(`${isPublication(media) ? "The publication" : "A screenshot"}: ${media.check.reason}`);
    }
  }
  if (reasons.length === 0) return false;
  await recordCheck(ctx, slopId, "slop", "mature", reasons.join(" "));
  return true;
}

/** A signed-in person flags a slop. Enough different people blur it. */
export const flag = mutation({
  args: { userId: v.id("users"), slopId: v.id("slops"), reason: v.string() },
  handler: async (ctx, { userId, slopId, reason }) => {
    await requireServer(ctx);
    const slop = await ctx.db.get(slopId);
    if (!slop) throw new ConvexError("That slop is gone.");
    if (slop.userId === userId) throw new ConvexError("You can't flag your own slop.");
    const existing = await ctx.db
      .query("reports")
      .withIndex("by_slop_reporter", (q) => q.eq("slopId", slopId).eq("reporterId", userId))
      .first();
    if (existing) return;
    await consume(ctx, `flag:${userId}`, 20, 86_400_000);
    await ctx.db.insert("reports", {
      slopId,
      reporterId: userId,
      reason: reason.trim().slice(0, 500) || "Inappropriate",
    });
    const people = new Set((await openFlags(ctx, slopId)).map((row) => row.reporterId).filter((id) => id !== null));
    if (people.size >= FLAGS_TO_BLUR && !slop.nsfw) await ctx.db.patch(slopId, { nsfw: true });
  },
});

export const hasFlagged = query({
  args: { userId: v.id("users"), slopId: v.id("slops") },
  handler: async (ctx, { userId, slopId }): Promise<boolean> => {
    await requireServer(ctx);
    const row = await ctx.db
      .query("reports")
      .withIndex("by_slop_reporter", (q) => q.eq("slopId", slopId).eq("reporterId", userId))
      .first();
    return row !== null;
  },
});

/** Every slop with open flags, most recently flagged first. Moderators only (checked by the server). */
export const queue = query({
  args: {},
  handler: async (ctx) => {
    await requireServer(ctx);
    const flags = await ctx.db.query("reports").order("desc").take(500);
    const bySlop = new Map<Id<"slops">, Doc<"reports">[]>();
    for (const row of flags) bySlop.set(row.slopId, [...(bySlop.get(row.slopId) ?? []), row]);

    const items = [];
    for (const [slopId, rows] of bySlop) {
      const slop = await ctx.db.get(slopId);
      if (!slop) continue;
      const owner = await ctx.db.get(slop.userId);
      if (!owner) continue;
      const reporters = await Promise.all(
        rows.map(async (row) => (row.reporterId ? await ctx.db.get(row.reporterId) : null)),
      );
      items.push({
        id: slop._id,
        name: slop.name,
        tagline: slop.tagline,
        slug: slop.slug,
        owner: owner.username,
        ownerId: owner._id,
        nsfw: slop.nsfw,
        hidden: slop.hidden,
        flags: rows.map((row, index) => ({
          id: row._id,
          reason: row.reason,
          by: row.reporterId === null ? null : (reporters[index]?.username ?? "deleted account"),
          at: row._creationTime,
        })),
      });
    }
    return items;
  },
});

/**
 * A moderator's decision on a flagged slop: "fine" clears the blur and
 * hiding, "nsfw" keeps it up but blurred, "hide" takes it down. Each one
 * closes the open flags. Moderators don't decide on their own slops.
 */
export const decide = mutation({
  args: { moderatorId: v.id("users"), slopId: v.id("slops"), decision: flagDecisionValidator },
  handler: async (ctx, { moderatorId, slopId, decision }) => {
    await requireServer(ctx);
    const moderator = await requirePermission(ctx, moderatorId, "queue.decide");
    const slop = await ctx.db.get(slopId);
    if (!slop) return;
    requireMayJudge(moderator, slop);
    if (decision === "fine") await ctx.db.patch(slopId, { nsfw: false, hidden: false });
    if (decision === "nsfw") await ctx.db.patch(slopId, { nsfw: true, hidden: false });
    if (decision === "hide") await ctx.db.patch(slopId, { hidden: true });
    await clearFlags(ctx, slopId);
    await logStaffAction(ctx, moderatorId, { type: "flags", slopId, decision }, slop);
  },
});
