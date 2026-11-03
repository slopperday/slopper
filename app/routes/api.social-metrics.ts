import type { Route } from "./+types/api.social-metrics";
import { syncMetrics } from "~/.server/social/studio";
import { allowAction, callerAddress } from "~/.server/tokens";

/**
 * Convex's cron calls this to read the stats that are due on sent studio
 * posts (`social.syncMetrics`). Only due rows are claimed, and each is
 * leased, so calling it again early reads nothing twice.
 */
export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (!(await allowAction(`social-metrics:${callerAddress(request)}`, 60, 3_600_000))) {
    return new Response(null, { status: 404 });
  }
  const read = await syncMetrics();
  return new Response(null, { status: read ? 204 : 404 });
}
