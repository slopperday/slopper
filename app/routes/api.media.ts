import { data } from "react-router";
import type { Route } from "./+types/api.media";
import { viewerContext } from "~/.server/session";
import { uploadImage, uploadPublication } from "~/.server/media";

/** Screenshot and publication (PDF) uploads for the new-slop and edit forms. */
export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(viewerContext).user;
  if (!user) return data({ error: "Sign in first." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return data({ error: "No file received." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (form.get("kind") === "publication") {
    const result = await uploadPublication(user._id, { bytes, fileName: file.name });
    if (!result.ok) return data({ error: result.error }, { status: 400 });
    const { id, url, fileName } = result;
    return data({ id, url, fileName, size: bytes.byteLength, nsfw: result.contentCheck === "mature" }, { status: 201 });
  }
  const result = await uploadImage(user._id, { bytes, fileName: file.name });
  if (!result.ok) return data({ error: result.error }, { status: 400 });
  return data({ id: result.id, url: result.url, nsfw: result.contentCheck === "mature" }, { status: 201 });
}
