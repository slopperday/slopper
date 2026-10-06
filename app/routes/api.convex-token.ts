import { data } from "react-router";
import type { Route } from "./+types/api.convex-token";
import { viewerContext } from "~/.server/session";
import { mintToken } from "~/.server/convex";

/** A short-lived token for the signed-in browser's live Convex queries. */
export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(viewerContext).user;
  if (!user) return data({ token: null }, { status: 401 });
  return data({ token: await mintToken(user._id) }, { headers: { "cache-control": "no-store" } });
}
