import type { Route } from "./+types/api.social-feeds";
import { syncFeeds } from "~/.server/social/automation";
import { allowAction, callerAddress } from "~/.server/tokens";

/**
 * Convex's cron calls this to post new items from people's RSS and Atom
 * feeds (`social.syncMetrics`). Only feeds due a look are claimed, and each
 * item carries an idempotency key, so an early or repeated call posts nothing twice.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (!(await allowAction(`social-feeds:${callerAddress(request)}`, 60, 3_600_000))) {
    return new Response(null, { status: 404 });
  }
  const made = await syncFeeds();
  return new Response(null, { status: made ? 204 : 404 });
}
