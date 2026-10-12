import type { Route } from "./+types/api.scheduled";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { finishLaunch } from "~/.server/launch";

/**
 * Convex calls this when a scheduled launch goes out (`schedule.tellApp`),
 * to run the content check and the auto-post, which need keys only this
 * server holds. It takes no credentials: it claims the release from Convex,
 * which hands each one out once, so calling it can only do sooner what
 * Convex is about to ask for. 404 when there's nothing to claim.
 */
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
  const claimed = await convex.mutation(api.schedule.claim, { id: params.id });
  if (!claimed) return new Response(null, { status: 404 });
  const owner = await convex.query(api.users.get, { userId: claimed.userId });
  if (!owner) return new Response(null, { status: 404 });
  await finishLaunch(owner, claimed, claimed.launchNote, claimed.autopost);
  return new Response(null, { status: 204 });
}
