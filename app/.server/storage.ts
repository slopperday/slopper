import { AwsClient } from "aws4fetch";
import type { Infer } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { mediaLocationValidator } from "@convex/schema";
import { type B2Config, config } from "./config";
import { convex, type ConvexCaller } from "./convex";
import { randomToken } from "./encoding";

/**
 * Where screenshot bytes live: a Backblaze B2 bucket, through its
 * S3-compatible API, when it's configured; Convex file storage otherwise
 * (local dev, tests). Either way Convex keeps the media row, which records
 * the backend and where in it the bytes are.
 */

export type MediaLocation = Infer<typeof mediaLocationValidator>;

/** Screenshots go on slops; avatars are copies of sign-in pictures that expire. */
export type MediaKind = "screenshot" | "avatar";

export interface MediaStore {
  readonly backend: MediaLocation["backend"];
  /** Stores an image the server has already checked. Throws when the store refuses it. */
  put(bytes: Uint8Array<ArrayBuffer>, contentType: string, kind: MediaKind): Promise<MediaLocation>;
}

const TIMEOUT_MS = 20_000;

/** A new upload always gets a new key, so an object never changes and caches can keep it for a year. */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

const FOLDERS: Readonly<Record<MediaKind, string>> = { screenshot: "screenshots", avatar: "avatars" };

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** SHA-256 of no bytes: every request signs its payload, even an empty one. */
const EMPTY_PAYLOAD_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A bucket behind an S3-compatible API (Backblaze B2), with requests signed
 * by AWS Signature V4. Objects go to random keys under `screenshots/` (or
 * `avatars/`), so two uploads never share an object and deleting one never
 * breaks another.
 */
export class S3Bucket implements MediaStore {
  readonly backend = "b2";
  readonly #settings: B2Config;
  readonly #client: AwsClient;
  readonly #fetcher: typeof fetch;

  constructor(settings: B2Config, fetcher: typeof fetch = fetch) {
    this.#settings = settings;
    this.#client = new AwsClient({
      accessKeyId: settings.keyId,
      secretAccessKey: settings.applicationKey,
      service: "s3",
      region: settings.region,
    });
    this.#fetcher = fetcher;
  }

  /** Path-style (`{endpoint}/{bucket}/{key}`), which every S3-compatible API serves. */
  objectUrl(key: string): string {
    return `${this.#settings.endpoint}/${this.#settings.bucket}/${key}`;
  }

  async put(bytes: Uint8Array<ArrayBuffer>, contentType: string, kind: MediaKind): Promise<MediaLocation> {
    const key = `${FOLDERS[kind]}/${randomToken(18)}.${EXTENSIONS[contentType] ?? "bin"}`;
    const request = await this.#client.sign(this.objectUrl(key), {
      method: "PUT",
      headers: {
        "content-type": contentType,
        "cache-control": CACHE_CONTROL,
        // The payload is signed too, so the bucket refuses bytes that changed on the way.
        "x-amz-content-sha256": await sha256Hex(bytes),
      },
      body: bytes,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const response = await this.#fetcher(request);
    if (!response.ok) throw new Error(`The bucket refused ${key} (${response.status}): ${await response.text()}`);
    return { backend: "b2", key };
  }

  /** Deletes an object. One that's already gone counts as deleted, so retrying is safe. */
  async remove(key: string): Promise<void> {
    const request = await this.#client.sign(this.objectUrl(key), {
      method: "DELETE",
      headers: { "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const response = await this.#fetcher(request);
    if (!response.ok && response.status !== 404) {
      throw new Error(`The bucket didn't delete ${key} (${response.status}): ${await response.text()}`);
    }
  }
}

/** Convex file storage: the app server posts the bytes to a one-off upload URL. */
export class ConvexStorage implements MediaStore {
  readonly backend = "convex";
  readonly #convex: ConvexCaller;
  readonly #fetcher: typeof fetch;

  constructor(caller: ConvexCaller = convex, fetcher: typeof fetch = fetch) {
    this.#convex = caller;
    this.#fetcher = fetcher;
  }

  async put(bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<MediaLocation> {
    const uploadUrl = await this.#convex.mutation(api.media.uploadUrl, {});
    const response = await this.#fetcher(uploadUrl, {
      method: "POST",
      headers: { "content-type": contentType },
      body: bytes,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Convex storage refused the upload (${response.status}).`);
    const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
    return { backend: "convex", storageId };
  }
}

/** The B2 bucket, when it's configured. */
export function b2Bucket(settings: B2Config | null = config.b2): S3Bucket | null {
  return settings ? new S3Bucket(settings) : null;
}

/** Where uploads go: the B2 bucket when it's configured, Convex file storage otherwise. */
export function mediaStore(settings: B2Config | null = config.b2, caller: ConvexCaller = convex): MediaStore {
  return b2Bucket(settings) ?? new ConvexStorage(caller);
}
