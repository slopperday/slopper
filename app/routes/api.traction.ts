import { data } from "react-router";
import type { Route } from "./+types/api.traction";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { syncProduct } from "~/.server/integrations";
import { allowAction, callerAddress } from "~/.server/tokens";

/**
 * Freshens a slop's traction. Its page calls this when its numbers are
 * stale, so whoever is looking pulls them in; Convex hands out each due
 * source once, so a crowd of viewers still syncs it once. The owner can
 * force a sync. The new numbers reach every open page through its live query.
 */
export async function action({ params, request, context }: Route.ActionArgs) {
  // Page views need room to browse; a single address can't keep looking up slops and claiming syncs unchecked.
  if (!(await allowAction(`traction:${callerAddress(request)}`, 60, 60_000))) {
    return data({ synced: 0 }, { status: 429 });
  }

  const found = await convex.query(api.slops.publicById, { id: params.id });
  if (!found) return data({ synced: 0 }, { status: 404 });
  const user = context.get(viewerContext).user;
  const force = (await request.formData()).get("force") === "1" && user?._id === found.owner.id;
  return { synced: await syncProduct(found.slop.productId, force) };
}
