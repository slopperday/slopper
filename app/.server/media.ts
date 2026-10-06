import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LIMITS } from "~/lib/model";
import { convex, convexMessage } from "./convex";

/** Recognises the image formats we accept by their magic bytes. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  return null;
}

export type UploadResult = { ok: true; id: Id<"media">; url: string | null } | { ok: false; error: string };

/**
 * Checks an image and stores it in Convex file storage. The browser form,
 * the REST API and MCP all upload through here.
 */
export async function uploadImage(ownerId: Id<"users">, bytes: Uint8Array<ArrayBuffer>): Promise<UploadResult> {
  if (bytes.byteLength === 0) return { ok: false, error: "Empty file." };
  if (bytes.byteLength > LIMITS.mediaBytes) return { ok: false, error: "Images must be 2 MB or smaller." };
  const contentType = sniffImageType(bytes);
  if (!contentType) return { ok: false, error: "Use a PNG, JPEG, WebP or GIF image." };

  try {
    const uploadUrl = await convex.mutation(api.media.uploadUrl, { userId: ownerId });
    const response = await fetch(uploadUrl, { method: "POST", headers: { "content-type": contentType }, body: bytes });
    if (!response.ok) return { ok: false, error: "Storage rejected the upload. Try again." };
    const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
    const { mediaId, url } = await convex.mutation(api.media.register, { ownerId, storageId });
    return { ok: true, id: mediaId, url };
  } catch (error) {
    const message = convexMessage(error);
    if (message) return { ok: false, error: message };
    throw error;
  }
}

/** Pairs media ids with their URLs, for re-rendering a form. Unknown ids are dropped. */
export async function screenshotsWithUrls(ids: readonly string[]): Promise<{ id: string; url: string }[]> {
  const shots: { id: string; url: string }[] = [];
  for (const id of ids) {
    const url = await convex.query(api.media.url, { mediaId: id });
    if (url) shots.push({ id, url });
  }
  return shots;
}
