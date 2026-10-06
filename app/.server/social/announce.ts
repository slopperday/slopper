import type { Kv } from "@deno/kv";
import type { CrosspostResult, Slop, SlopUpdate, User } from "~/lib/model";
import { listAccounts } from "../db/accounts";
import { saveCrossposts } from "../db/activity";
import { adaptersFor } from "./adapters";
import { buildPostContent, planCrossposts, runCrossposts } from "./crosspost";

/**
 * Auto-posts an update to the owner's connected accounts and records the outcome on
 * the update. Runs inline: Deno Deploy has no queues, and a handful of API
 * calls fits comfortably in one request.
 */
export async function announce(kv: Kv, owner: User, slop: Slop, update: SlopUpdate): Promise<CrosspostResult[]> {
  const accounts = await listAccounts(kv, owner.id);
  const plans = planCrossposts(slop, accounts);
  if (plans.length === 0) return [];
  const results = await runCrossposts(plans, buildPostContent(slop, update, owner.username), adaptersFor(kv));
  await saveCrossposts(kv, slop.id, update.id, results);
  return results;
}

/**
 * Re-runs only the accounts that failed last time, keeping the successes,
 * so a retry never double-posts.
 */
export async function retryFailed(kv: Kv, owner: User, slop: Slop, update: SlopUpdate): Promise<CrosspostResult[]> {
  const failed = new Set(
    update.crossposts.filter((result) => result.status === "error").map((result) => result.accountId),
  );
  if (failed.size === 0) return update.crossposts;
  const accounts = (await listAccounts(kv, owner.id)).filter((account) => failed.has(account.id));
  const retried = await runCrossposts(
    planCrossposts(slop, accounts),
    buildPostContent(slop, update, owner.username),
    adaptersFor(kv),
  );
  const byAccount = new Map(update.crossposts.map((result) => [result.accountId, result]));
  for (const result of retried) byAccount.set(result.accountId, result);
  const merged = [...byAccount.values()];
  await saveCrossposts(kv, slop.id, update.id, merged);
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
