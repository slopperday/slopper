import { isbot } from "isbot";
import type { Route } from "./+types/go";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { notFound } from "~/.server/http";
import { allowAction, callerAddress } from "~/.server/tokens";

/**
 * A studio post's tracked link (`/go/:code`): counts the click for the
 * network it went out on, then sends the visitor on with its UTM tags.
 * Link previews and crawlers are sent on without counting. The address
 * ceiling comes first: each click is a Convex write.
 */
export async function loader({ request, params }: Route.LoaderArgs) {
  if (!(await allowAction(`go:${callerAddress(request)}`, 600, 3_600_000))) {
    return new Response("Slow down a little.", { status: 429 });
  }
  const person = !isbot(request.headers.get("user-agent") ?? "");
  const url = await convex.mutation(api.studio.follow, { code: params.code, count: person });
  if (!url) notFound();
  return new Response(null, {
    status: 302,
    headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer-when-downgrade" },
  });
}
