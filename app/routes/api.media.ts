import { data } from "react-router";
import type { Route } from "./+types/api.media";
import { getKv } from "~/.server/kv";
import { viewerContext } from "~/.server/session";
import { saveMedia } from "~/.server/db/media";
import { allowAction } from "~/.server/db/misc";
import { mediaUrl } from "~/lib/display";

/** Screenshot upload for the new-slop and edit forms. */
export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(viewerContext).user;
  if (!user) return data({ error: "Sign in first." }, { status: 401 });
  const kv = await getKv();
  if (!(await allowAction(kv, "upload", user.id, 60, 3_600_000))) {
    return data({ error: "Too many uploads. Try again in a bit." }, { status: 429 });
  }
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return data({ error: "No file received." }, { status: 400 });
  const result = await saveMedia(kv, user.id, new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) return data({ error: result.error }, { status: 400 });
  return data({ id: result.media.id, url: mediaUrl(result.media.id) }, { status: 201 });
}
