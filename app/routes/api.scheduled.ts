import type { Route } from "./+types/api.scheduled";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { finishLaunch } from "~/.server/launch";
import { allowAction, callerAddress } from "~/.server/tokens";

/** Convex document ids: 22+ letters and digits, as `normalizeId` expects. */
const ID = /^[a-z0-9]{22,64}$/;

/**
 * Convex calls this when a scheduled launch goes out (`schedule.tellApp`),
 * to run the content check and the auto-post, which need keys only this
 * server holds. It takes no credentials: it claims the release from Convex,
 * which hands each one out once, so calling it can only do sooner what
 * Convex is about to ask for. 404 when there's nothing to claim.
 */
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  // The claim is a Convex mutation, so an address ceiling keeps random ids
  // from being posted here at request speed; Convex's own calls come from its
  // backend and sit far below it.
  if (!ID.test(params.id) || !(await allowAction(`scheduled:${callerAddress(request)}`, 600, 3_600_000))) {
    return new Response(null, { status: 404 });
  }
  const claimed = await convex.mutation(api.schedule.claim, { id: params.id });
  if (!claimed) return new Response(null, { status: 404 });
  const owner = await convex.query(api.users.get, { userId: claimed.userId });
  if (!owner) return new Response(null, { status: 404 });
  await finishLaunch(owner, claimed, claimed.launchNote, claimed.autopost);
  return new Response(null, { status: 204 });
}
