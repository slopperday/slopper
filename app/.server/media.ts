import type { Infer } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { mediaCheckValidator } from "@convex/schema";
import { LIMITS } from "~/lib/model";
import { config, type ContentCheckConfig } from "./config";
import { convex, type ConvexCaller, convexMessage } from "./convex";
import { tryCheck, uploadSubmission } from "./moderation";
import { b2Bucket, type MediaKind, type MediaStore, mediaStore, type S3Bucket } from "./storage";

/** Recognises the image formats we accept by their magic bytes. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  return null;
}

/** Recognises the video formats we accept: MP4 (an `ftyp` box first) and WebM (EBML). */
export function sniffVideoType(bytes: Uint8Array): string | null {
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp") return "video/mp4";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video/webm";
  return null;
}

/** What the upload check said about a stored image. */
export type MediaCheck = Infer<typeof mediaCheckValidator>;

export const BLOCKED_IMAGE = "This image can't go on Slopper.";

export interface ImageUpload {
  bytes: Uint8Array<ArrayBuffer>;
  /** The name the browser sent, if any; the check reads it too. */
  fileName?: string | null;
  /**
   * A screenshot (the default) or an avatar. Avatars show everywhere,
   * unblurred, so a mature one is refused like a blocked one.
   */
  kind?: Exclude<MediaKind, "video">;
}

export type UploadResult =
  | { ok: true; id: Id<"media">; url: string | null; contentCheck: MediaCheck["verdict"] }
  | { ok: false; error: string };

/** What an upload talks to. Tests swap in fakes. */
export interface UploadServices {
  store: MediaStore;
  convex: ConvexCaller;
  contentCheck: ContentCheckConfig | null;
  fetcher: typeof fetch;
}

function uploadServices(): UploadServices {
  return { store: mediaStore(), convex, contentCheck: config.contentCheck, fetcher: fetch };
}

/**
 * Checks an image and stores it. The browser form, the REST API and MCP all
 * upload through here.
 *
 * The content check runs before anything is stored: a blocked image (nudity,
 * sexual content, slurs or abuse, including text in the image) is refused and
 * never kept. A mature one is stored and marked, and any slop that shows it is
 * blurred (convex/moderation.ts, `checkScreenshots`).
 *
 * When the check can't run (no DEEPSEEK_API_KEY, a timeout, an error), the
 * image is stored as "unchecked" rather than refused, so uploads don't depend
 * on DeepSeek being up. That's the tradeoff: an unchecked image can sit on a
 * slop's page until the launch check reads it (it reads every screenshot
 * again), and nothing auto-posts until a slop passes that check.
 */
export async function uploadImage(
  ownerId: Id<"users">,
  { bytes, fileName, kind = "screenshot" }: ImageUpload,
  services: UploadServices = uploadServices(),
): Promise<UploadResult> {
  if (bytes.byteLength === 0) return { ok: false, error: "Empty file." };
  if (bytes.byteLength > LIMITS.mediaBytes)
    return { ok: false, error: `Images must be ${LIMITS.mediaBytes / 1024 / 1024} MB or smaller.` };
  const contentType = sniffImageType(bytes);
  if (!contentType) return { ok: false, error: "Use a PNG, JPEG, WebP or GIF image." };

  try {
    await services.convex.mutation(api.media.beginUpload, { userId: ownerId, backend: services.store.backend });

    const result = await tryCheck(
      uploadSubmission(bytes, contentType, kind, fileName),
      services.contentCheck,
      services.fetcher,
    );
    if (result?.verdict === "blocked" || (result?.verdict === "mature" && kind === "avatar")) {
      console.warn(`Refused an upload from ${ownerId}: ${result.reason}`);
      return { ok: false, error: BLOCKED_IMAGE };
    }
    const check: MediaCheck = result
      ? { verdict: result.verdict === "mature" ? "mature" : "ok", reason: result.reason }
      : { verdict: "unchecked", reason: "The content check couldn't run at upload." };

    const location = await services.store.put(bytes, contentType, kind).catch((error: unknown) => {
      console.error("Storing an upload failed", error);
      return null;
    });
    if (!location) return { ok: false, error: "That upload didn't save. Try again." };
    const { mediaId, url } = await services.convex.mutation(api.media.register, {
      ownerId,
      location,
      contentType,
      size: bytes.byteLength,
      check,
    });
    return { ok: true, id: mediaId, url, contentCheck: check.verdict };
  } catch (error) {
    const message = convexMessage(error);
    if (message) return { ok: false, error: message };
    throw error;
  }
}

export type VideoUploadResult = { ok: true; id: Id<"media">; url: string | null } | { ok: false; error: string };

/**
 * Stores a promo video, "unchecked". Nothing plays until it's on a slop and
 * approved there: by a moderator, or for trusted uploaders by the video check
 * (convex/videos.ts, `checkVideo` in ./moderation.ts). The rate limit is
 * shared with images.
 */
export async function uploadVideo(
  ownerId: Id<"users">,
  bytes: Uint8Array<ArrayBuffer>,
  services: UploadServices = uploadServices(),
): Promise<VideoUploadResult> {
  if (bytes.byteLength === 0) return { ok: false, error: "Empty file." };
  if (bytes.byteLength > LIMITS.videoBytes) {
    return { ok: false, error: `Videos must be ${LIMITS.videoBytes / 1024 / 1024} MB or smaller.` };
  }
  const contentType = sniffVideoType(bytes);
  if (!contentType) return { ok: false, error: "Use an MP4 or WebM video." };
  try {
    await services.convex.mutation(api.media.beginUpload, { userId: ownerId, backend: services.store.backend });
    const location = await services.store.put(bytes, contentType, "video").catch((error: unknown) => {
      console.error("Storing a video failed", error);
      return null;
    });
    if (!location) return { ok: false, error: "That upload didn't save. Try again." };
    const { mediaId, url } = await services.convex.mutation(api.media.register, {
      ownerId,
      location,
      contentType,
      size: bytes.byteLength,
      check: { verdict: "unchecked", reason: "Videos are checked on their slop." },
    });
    return { ok: true, id: mediaId, url };
  } catch (error) {
    const message = convexMessage(error);
    if (message) return { ok: false, error: message };
    throw error;
  }
}

/**
 * Keeps a copy of a new account's profile picture (in the B2 bucket, or
 * Convex storage), for providers whose picture URLs expire. It's checked like
 * any upload. Best effort: without it the account shows its initial, so a
 * failure or a refused picture is logged rather than stopping sign-in.
 */
export async function copyAvatar(userId: Id<"users">, pictureUrl: string): Promise<void> {
  try {
    const response = await fetch(pictureUrl);
    if (!response.ok) throw new Error(`Picture request failed (${response.status})`);
    const upload = await uploadImage(userId, { bytes: new Uint8Array(await response.arrayBuffer()), kind: "avatar" });
    if (!upload.ok) throw new Error(upload.error);
    if (upload.url) await convex.mutation(api.users.setAvatar, { userId, avatarUrl: upload.url });
  } catch (error) {
    console.error("Couldn't keep a copy of the profile picture", error);
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

/** How many orphaned objects one cleanup deletes; the rest wait for the next. */
const CLEANUP_BATCH = 25;

/**
 * Deletes B2 objects no slop shows any more, then forgets their rows. Runs
 * after a delete or edit that orphaned some (Convex marks them; see
 * `releaseMedia` in convex/lib/media.ts).
 *
 * Best effort, and never fails the request that triggered it: the slop is
 * already gone. An object that won't delete keeps its row, so the next
 * cleanup tries it again; nothing is forgotten until the bucket confirms.
 */
export async function deleteOrphanedMedia(
  bucket: S3Bucket | null = b2Bucket(),
  caller: ConvexCaller = convex,
): Promise<void> {
  // Without the bucket's key there's nothing to delete with; the rows wait for it.
  if (!bucket) return;
  try {
    const orphans = await caller.query(api.media.orphans, { limit: CLEANUP_BATCH });
    const deleted: Id<"media">[] = [];
    for (const orphan of orphans) {
      try {
        await bucket.remove(orphan.key);
        deleted.push(orphan.id);
      } catch (error) {
        console.error(`Couldn't delete ${orphan.key} from the bucket; it stays queued`, error);
      }
    }
    if (deleted.length > 0) await caller.mutation(api.media.forget, { ids: deleted });
  } catch (error) {
    console.error("Cleaning up orphaned screenshots failed; they stay queued", error);
  }
}
