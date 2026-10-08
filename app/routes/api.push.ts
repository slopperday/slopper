import { data } from "react-router";
import type { Route } from "./+types/api.push";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { config } from "~/.server/config";
import { isPushEndpoint, parseSubscription } from "~/.server/push";

/**
 * Browser notifications for the signed-in person. POST stores this
 * browser's push subscription (`PushSubscription.toJSON()`); DELETE drops
 * it (`{ endpoint }`). Both are idempotent.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(viewerContext).user;
  if (!user) return data({ error: "Sign in to turn on notifications." }, { status: 401 });
  if (!config.vapidPublicKey) return data({ error: "Browser notifications aren't set up here." }, { status: 404 });
  const body: unknown = await request.json().catch(() => null);

  if (request.method === "POST") {
    const subscription = parseSubscription(body);
    if (!subscription) return data({ error: "That isn't a push subscription." }, { status: 400 });
    await convex.mutation(api.push.subscribe, { userId: user._id, ...subscription });
    return new Response(null, { status: 204 });
  }
  if (request.method === "DELETE") {
    const endpoint = typeof body === "object" && body !== null ? (body as { endpoint?: unknown }).endpoint : null;
    if (!isPushEndpoint(endpoint)) return data({ error: "That isn't a push subscription." }, { status: 400 });
    await convex.mutation(api.push.unsubscribe, { userId: user._id, endpoint });
    return new Response(null, { status: 204 });
  }
  return data({ error: "Method not allowed." }, { status: 405, headers: { allow: "POST, DELETE" } });
}
