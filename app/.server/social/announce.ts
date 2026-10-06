import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { CrosspostResult } from "~/lib/model";
import { convex } from "../convex";
import { adapters } from "./adapters";
import { buildPostContent, planCrossposts, runCrossposts } from "./crosspost";

/**
 * Auto-posts an update to the owner's connected accounts and records the
 * outcome on the update. Runs inline: a handful of API calls fits in one
 * request, and failures can be retried from the update.
 */
export async function announce(
  owner: Pick<Doc<"users">, "_id" | "username">,
  slopId: Id<"slops">,
  updateId: Id<"updates">,
): Promise<CrosspostResult[]> {
  const [slop, update, accounts] = await Promise.all([
    convex.query(api.slops.getForServer, { slopId }),
    convex.query(api.activity.getUpdate, { updateId }),
    convex.query(api.accounts.list, { userId: owner._id }),
  ]);
  if (!slop || !update) return [];
  const plans = planCrossposts(slop, accounts);
  if (plans.length === 0) return [];
  const screenshots = await Promise.all(
    slop.screenshots.slice(0, 1).map((mediaId) => convex.query(api.media.url, { mediaId })),
  );
  const content = buildPostContent(
    { ...slop, screenshots: screenshots.filter((url): url is string => url !== null) },
    update,
    owner.username,
  );
  const results = await runCrossposts(plans, content, adapters());
  await convex.mutation(api.activity.saveCrossposts, { updateId, crossposts: results });
  return results;
}

/**
 * Re-runs only the accounts that failed last time, keeping the successes,
 * so a retry never double-posts.
 */
export async function retryFailed(
  owner: Pick<Doc<"users">, "_id" | "username">,
  updateId: string,
): Promise<CrosspostResult[]> {
  const update = await convex.query(api.activity.getUpdate, { updateId });
  if (!update) return [];
  const failed = new Set(update.crossposts.filter((result) => result.status === "error").map((r) => r.accountId));
  if (failed.size === 0) return update.crossposts;
  const [slop, accounts] = await Promise.all([
    convex.query(api.slops.getForServer, { slopId: update.slopId }),
    convex.query(api.accounts.list, { userId: owner._id }),
  ]);
  if (!slop) return update.crossposts;
  const screenshots = await Promise.all(
    slop.screenshots.slice(0, 1).map((mediaId) => convex.query(api.media.url, { mediaId })),
  );
  const retried = await runCrossposts(
    planCrossposts(
      slop,
      accounts.filter((account) => failed.has(account._id)),
    ),
    buildPostContent(
      { ...slop, screenshots: screenshots.filter((url): url is string => url !== null) },
      update,
      owner.username,
    ),
    adapters(),
  );
  const byAccount = new Map(update.crossposts.map((result) => [result.accountId, result]));
  for (const result of retried) byAccount.set(result.accountId, result);
  const merged = [...byAccount.values()];
  await convex.mutation(api.activity.saveCrossposts, { updateId: update._id, crossposts: merged });
  return merged;
}

/** One-line summary for a flash message. */
export function summarize(results: readonly CrosspostResult[]): string {
  if (results.length === 0) return "";
  const ok = results.filter((result) => result.status === "ok").length;
  const failed = results.filter((result) => result.status === "error").length;
  if (failed === 0) return ` Auto-posted to ${ok} account${ok === 1 ? "" : "s"}.`;
  return ` Auto-posted to ${ok}; ${failed} failed (see the update).`;
}
