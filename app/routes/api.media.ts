import { data } from "react-router";
import type { Route } from "./+types/api.media";
import { viewerContext } from "~/.server/session";
import { uploadImage, uploadPublication } from "~/.server/media";
import { allowAction, callerAddress } from "~/.server/tokens";

/** Screenshot and publication (PDF or EPUB) uploads for the new-slop and edit forms. */
export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(viewerContext).user;
  if (!user) return data({ error: "Sign in first." }, { status: 401 });

  // Malformed forms never reach beginUpload, so body reads need their own attempt limits.
  if (!(await allowAction(`media-body:ip:${callerAddress(request)}`, 120, 3_600_000))) {
    return data({ error: "Slow down a little. Try again later." }, { status: 429 });
  }

  if (!(await allowAction(`media-body:user:${user._id}`, 60, 3_600_000))) {
    return data({ error: "Slow down a little. Try again later." }, { status: 429 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return data({ error: "No file received." }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (form.get("kind") === "publication") {
    const result = await uploadPublication(user._id, { bytes, fileName: file.name });
    if (!result.ok) return data({ error: result.error }, { status: 400 });
    const { id, url, fileName, format } = result;
    const nsfw = result.contentCheck === "mature";
    return data({ id, url, fileName, format, size: bytes.byteLength, nsfw }, { status: 201 });
  }
  const result = await uploadImage(user._id, { bytes, fileName: file.name });
  if (!result.ok) return data({ error: result.error }, { status: 400 });
  return data({ id: result.id, url: result.url, nsfw: result.contentCheck === "mature" }, { status: 201 });
}
