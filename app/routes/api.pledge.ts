import { data } from "react-router";
import type { Route } from "./+types/api.pledge";
import { getKv } from "~/.server/kv";
import { viewerContext } from "~/.server/session";
import { setPledge } from "~/.server/db/pledges";
import { allowAction } from "~/.server/db/misc";
import { invalidateFeeds } from "~/.server/memo";
import { parseAmount } from "~/lib/money";

/** Pledge (or withdraw) a non-binding "take my money" amount in USD. */
export async function action({ request, params, context }: Route.ActionArgs) {
  const user = context.get(viewerContext).user;
  if (!user) return data({ error: "Sign in to pledge." }, { status: 401 });
  const form = await request.formData();
  // Preset and withdraw buttons submit `amount`; the free-text box is `custom`.
  const value = form.get("amount") ?? form.get("custom");
  const raw = typeof value === "string" ? value : "";
  const amount = raw === "0" ? 0 : parseAmount(raw);
  if (amount === null) return data({ error: "Enter an amount like 10 or 12.50." }, { status: 400 });

  const kv = await getKv();
  if (!(await allowAction(kv, "pledge", user.id, 60, 3_600_000))) {
    return data({ error: "Slow down a little." }, { status: 429 });
  }
  const result = await setPledge(kv, params.id, user.id, amount);
  if (!result.ok) {
    const message = {
      "not-found": "Slop not found.",
      "own-slop": "You can't pledge to your own slop.",
      "invalid-amount": "Pledges go up to $10,000.",
    }[result.reason];
    return data({ error: message }, { status: result.reason === "not-found" ? 404 : 400 });
  }
  invalidateFeeds();
  return { backers: result.backers, pledged: result.pledged, amount: result.amount, error: null };
}
