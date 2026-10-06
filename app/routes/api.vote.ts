import { data } from "react-router";
import type { Route } from "./+types/api.vote";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex, convexMessage } from "~/.server/convex";

function parseVote(value: FormDataEntryValue | null): 1 | -1 | 0 | null {
  if (value === "1") return 1;
  if (value === "-1") return -1;
  if (value === "0") return 0;
  return null;
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const user = context.get(viewerContext).user;
  if (!user) return data({ error: "Sign in to vote." }, { status: 401 });
  const value = parseVote((await request.formData()).get("vote"));
  if (value === null) return data({ error: "Bad vote." }, { status: 400 });
  try {
    return await convex.mutation(api.slops.vote, { userId: user._id, slopId: params.id, value });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return data({ error: message }, { status: 400 });
    throw error;
  }
}
