import { data } from "react-router";
import type { Route } from "./+types/api.vote";
import { getKv } from "~/.server/kv";
import { viewerContext } from "~/.server/session";
import { castVote, type Vote } from "~/.server/db/slops";
import { allowAction } from "~/.server/db/misc";
import { invalidateFeeds } from "~/.server/memo";

function parseVote(value: FormDataEntryValue | null): Vote | null {
  if (value === "1") return 1;
  if (value === "-1") return -1;
  if (value === "0") return 0;
  return null;
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const user = context.get(viewerContext).user;
  if (!user) return data({ error: "Sign in to vote." }, { status: 401 });
  const vote = parseVote((await request.formData()).get("vote"));
  if (vote === null) return data({ error: "Bad vote." }, { status: 400 });

  const kv = await getKv();
  if (!(await allowAction(kv, "vote", user.id, 120, 3_600_000))) {
    return data({ error: "Slow down a little." }, { status: 429 });
  }
  const result = await castVote(kv, params.id, user.id, vote);
  if (!result.ok) {
    const own = result.reason === "own-slop";
    return data({ error: own ? "You can't vote on your own slop." : "Slop not found." }, { status: own ? 403 : 404 });
  }
  invalidateFeeds();
  return { upvotes: result.upvotes, vote: result.vote };
}
