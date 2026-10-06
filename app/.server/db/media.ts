import type { Kv } from "@deno/kv";
import type { MediaMeta } from "~/lib/model";
import { LIMITS } from "~/lib/model";
import { newId } from "../kv";

/** KV values max out at 64 KiB; stay comfortably below it. */
const CHUNK_BYTES = 60_000;
/** Chunks per atomic commit, keeping each commit well under 800 KB. */
const CHUNKS_PER_COMMIT = 10;

/** Recognises the image formats we accept by their magic bytes. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  return null;
}

export type SaveMediaResult = { ok: true; media: MediaMeta } | { ok: false; error: string };

export async function saveMedia(kv: Kv, ownerId: string, bytes: Uint8Array): Promise<SaveMediaResult> {
  if (bytes.byteLength === 0) return { ok: false, error: "Empty file." };
  if (bytes.byteLength > LIMITS.mediaBytes) {
    return { ok: false, error: "Images must be 2 MB or smaller." };
  }
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return { ok: false, error: "Use a PNG, JPEG, WebP or GIF image." };
  }

  const media: MediaMeta = {
    id: newId(),
    ownerId,
    contentType,
    size: bytes.byteLength,
    chunkCount: Math.ceil(bytes.byteLength / CHUNK_BYTES),
    createdAt: new Date().toISOString(),
  };

  for (let first = 0; first < media.chunkCount; first += CHUNKS_PER_COMMIT) {
    const op = kv.atomic();
    const last = Math.min(first + CHUNKS_PER_COMMIT, media.chunkCount);
    for (let index = first; index < last; index++) {
      const chunk = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
      op.set(["media_chunk", media.id, index], chunk);
    }
    const result = await op.commit();
    if (!result.ok) throw new Error("Failed to store image chunks");
  }
  // The metadata lands last, so a half-written upload is never served.
  await kv.set(["media", media.id], media);
  return { ok: true, media };
}

export async function getMediaMeta(kv: Kv, id: string): Promise<MediaMeta | null> {
  return (await kv.get<MediaMeta>(["media", id])).value;
}

export async function readMediaBytes(kv: Kv, media: MediaMeta): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new Uint8Array(media.size);
  let offset = 0;
  for await (const entry of kv.list<Uint8Array>({ prefix: ["media_chunk", media.id] })) {
    bytes.set(entry.value, offset);
    offset += entry.value.byteLength;
  }
  if (offset !== media.size) {
    throw new Error(`Media ${media.id} is incomplete`);
  }
  return bytes;
}

/**
 * Keeps only media ids that exist and belong to `ownerId`, preserving order.
 * Ids already attached to the slop being edited are always kept.
 */
export async function ownedMediaIds(
  kv: Kv,
  ownerId: string,
  ids: readonly string[],
  alreadyAttached: readonly string[] = [],
): Promise<string[]> {
  const kept: string[] = [];
  for (const id of ids) {
    if (alreadyAttached.includes(id)) {
      kept.push(id);
      continue;
    }
    const meta = await getMediaMeta(kv, id);
    if (meta?.ownerId === ownerId) kept.push(id);
  }
  return kept;
}
