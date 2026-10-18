import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { CrosspostResult } from "~/lib/model";
import { convex } from "../convex";
import { checkUpdate } from "../moderation";
import { adapters } from "./adapters";
import { buildPostContent, planCrossposts, runCrossposts } from "./crosspost";

/** What happened when asked to auto-post: it went out, or it's held and why. */
export type AutopostOutcome = { status: "posted"; results: CrosspostResult[] } | { status: "held"; reason: string };

/**
 * Why this update may not be auto-posted, or null when it may. The slop
 * must have passed the content check with no open flags; an update other
 * than the launch is checked on its own too (the launch note was checked
 * with the slop).
 */
async function holdReason(slopId: Id<"slops">, update: Doc<"updates">): Promise<string | null> {
  const held = await convex.query(api.moderation.autopostHoldFor, { slopId });
  if (held) return held;
  if (update.kind === "launch") return null;
  const check = await checkUpdate(slopId, update);
  if (!check) return "it couldn't be cleared just now";
  return check.verdict === "ok" ? null : "this update wasn't cleared for posting";
}

/** The post carries the update's first image, or the slop's cover when it has none. */
async function postContent(slop: Doc<"slops">, update: Doc<"updates">, username: string) {
  const image = update.images?.[0] ?? slop.screenshots[0];
  const screenshots = await Promise.all(
    (image ? [image] : []).map((mediaId) => convex.query(api.media.url, { mediaId })),
  );
  return buildPostContent(
    { ...slop, screenshots: screenshots.filter((url): url is string => url !== null) },
    update,
    username,
  );
}

/**
 * Auto-posts an update to the owner's connected accounts and records the
 * outcome on the update. Runs inline: a handful of API calls fits in one
 * request, and failures can be retried from the update.
 */
export async function announce(
  owner: Pick<Doc<"users">, "_id" | "username">,
  slopId: Id<"slops">,
  updateId: Id<"updates">,
): Promise<AutopostOutcome> {
  const [slop, update, accounts] = await Promise.all([
    convex.query(api.slops.getForServer, { slopId }),
    convex.query(api.activity.getUpdate, { updateId }),
    convex.query(api.accounts.list, { userId: owner._id }),
  ]);
  if (!slop || !update) return { status: "posted", results: [] };
  const plans = planCrossposts(slop, accounts);
  if (plans.length === 0) return { status: "posted", results: [] };
  const held = await holdReason(slopId, update);
  if (held) return { status: "held", reason: held };

  const results = await runCrossposts(plans, await postContent(slop, update, owner.username), adapters());
  await convex.mutation(api.activity.saveCrossposts, { updateId, crossposts: results });
  return { status: "posted", results };
}

/**
 * Re-runs only the accounts that failed last time, keeping the successes,
 * so a retry never double-posts. Held like a first attempt if the slop has
 * been flagged since.
 */
export async function retryFailed(
  owner: Pick<Doc<"users">, "_id" | "username">,
  updateId: string,
): Promise<AutopostOutcome> {
  const update = await convex.query(api.activity.getUpdate, { updateId });
  if (!update) return { status: "posted", results: [] };
  // The page checks the slop's owner; this ties the update itself to them too,
  // so a crafted form can't push someone else's update through these accounts.
  if (update.userId !== owner._id) return { status: "posted", results: update.crossposts };
  const failed = new Set(update.crossposts.filter((result) => result.status === "error").map((r) => r.accountId));
  if (failed.size === 0) return { status: "posted", results: update.crossposts };
  const [slop, accounts] = await Promise.all([
    convex.query(api.slops.getForServer, { slopId: update.slopId }),
    convex.query(api.accounts.list, { userId: owner._id }),
  ]);
  if (!slop) return { status: "posted", results: update.crossposts };
  const held = await holdReason(slop._id, update);
  if (held) return { status: "held", reason: held };

  const retried = await runCrossposts(
    planCrossposts(
      slop,
      accounts.filter((account) => failed.has(account._id)),
    ),
    await postContent(slop, update, owner.username),
    adapters(),
  );
  const byAccount = new Map(update.crossposts.map((result) => [result.accountId, result]));
  for (const result of retried) byAccount.set(result.accountId, result);
  const merged = [...byAccount.values()];
  await convex.mutation(api.activity.saveCrossposts, { updateId: update._id, crossposts: merged });
  return { status: "posted", results: merged };
}

/** One-line summary for a flash message. */
export function summarize(outcome: AutopostOutcome): string {
  if (outcome.status === "held") return ` Not auto-posted: ${outcome.reason}.`;
  const { results } = outcome;
  if (results.length === 0) return "";
  const ok = results.filter((result) => result.status === "ok").length;
  const failed = results.filter((result) => result.status === "error").length;
  if (failed === 0) return ` Auto-posted to ${ok} account${ok === 1 ? "" : "s"}.`;
  return ` Auto-posted to ${ok}; ${failed} failed (see the update).`;
}
