import type { Route } from "./+types/api.social";
import { deliver } from "~/.server/social/studio";
import { allowAction, callerAddress } from "~/.server/tokens";

/** Convex document ids: 22+ letters and digits, as `normalizeId` expects. */
const ID = /^[a-z0-9]{22,64}$/;

/**
 * Convex calls this when a studio post is due, or an upload is due another
 * look (`social.tellApp`). Like /api/scheduled/:id it takes no
 * credentials: the deliveries are claimed from Convex, once each, so a
 * forged call can only send early what was about to go anyway.
 */
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  if (!ID.test(params.id) || !(await allowAction(`social:${callerAddress(request)}`, 600, 3_600_000))) {
    return new Response(null, { status: 404 });
  }
  const handled = await deliver(params.id);
  return new Response(null, { status: handled ? 204 : 404 });
}
