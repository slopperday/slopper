import type { Route } from "./+types/media";
import { getKv } from "~/.server/kv";
import { getMediaMeta, readMediaBytes } from "~/.server/db/media";
import { notFound } from "~/.server/http";

/** Serves stored images. Ids never change content, so cache forever. */
export async function loader({ params, request }: Route.LoaderArgs) {
  const etag = `"${params.id}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag } });
  }
  const kv = await getKv();
  const meta = await getMediaMeta(kv, params.id);
  if (!meta) notFound();
  return new Response(await readMediaBytes(kv, meta), {
    headers: {
      "content-type": meta.contentType,
      "content-length": String(meta.size),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      etag,
    },
  });
}
