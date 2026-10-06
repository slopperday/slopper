import { data } from "react-router";
import type { Route } from "./+types/api.pledge";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex, convexMessage } from "~/.server/convex";
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
  try {
    const result = await convex.mutation(api.slops.pledge, {
      userId: user._id,
      slopId: params.id,
      amount,
    });
    return { ...result, error: null };
  } catch (error) {
    const message = convexMessage(error);
    if (message) return data({ error: message }, { status: 400 });
    throw error;
  }
}
