import { data } from "react-router";
import type { Route } from "./+types/api.media";
import { viewerContext } from "~/.server/session";
import { uploadImage } from "~/.server/media";

/** Screenshot upload for the new-slop and edit forms. */
export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(viewerContext).user;
  if (!user) return data({ error: "Sign in first." }, { status: 401 });
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return data({ error: "No file received." }, { status: 400 });
  const result = await uploadImage(user._id, new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) return data({ error: result.error }, { status: 400 });
  return data({ id: result.id, url: result.url }, { status: 201 });
}
