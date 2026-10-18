import type { MutationCtx } from "../_generated/server";
import { cleanTags, tagKey } from "../../app/lib/tags";

/**
 * Counts a slop's "Made with" tags as they change from `before` to `after`
 * and returns `after` cleaned, each tag spelled the way it was first used (or
 * the way we spell a known one), so "claude code" and "Claude Code" are one
 * tag. Call it wherever a slop's tags are written or the slop goes.
 */
export async function retag(ctx: MutationCtx, before: readonly string[], after: readonly string[]): Promise<string[]> {
  const tags: string[] = [];
  for (const name of cleanTags(after)) {
    const row = await tagRow(ctx, name);
    tags.push(row?.name ?? name);
  }
  const was = new Set(before.map(tagKey));
  const now = new Set(tags.map(tagKey));
  for (const name of before) {
    if (now.has(tagKey(name))) continue;
    const row = await tagRow(ctx, name);
    if (row) await ctx.db.patch(row._id, { uses: Math.max(0, row.uses - 1) });
  }
  for (const name of tags) {
    if (was.has(tagKey(name))) continue;
    const row = await tagRow(ctx, name);
    if (row) await ctx.db.patch(row._id, { uses: row.uses + 1 });
    else await ctx.db.insert("madeWithTags", { key: tagKey(name), name, uses: 1 });
  }
  return tags;
}

async function tagRow(ctx: MutationCtx, name: string) {
  return await ctx.db
    .query("madeWithTags")
    .withIndex("by_key", (q) => q.eq("key", tagKey(name)))
    .unique();
}
