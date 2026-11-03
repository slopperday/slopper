import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LIMITS } from "~/lib/model";
import { convex, convexMessage } from "../convex";
import { seal, unseal } from "../crypto";
import { sniffVideoType } from "../media";
import { b2Bucket, type MediaLocation } from "../storage";

/**
 * Studio videos are too big to pass through the app server (Netlify caps a
 * request at 6 MB), so the browser sends them straight to storage: a
 * presigned PUT to the B2 bucket, or a Convex upload URL without B2. The
 * server hands out a sealed ticket naming where the bytes go and who sends
 * them, then registers the upload once it can see the bytes there and they
 * really are a video.
 */

const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const TICKET_MS = 60 * 60_000;

interface Ticket {
  userId: Id<"users">;
  backend: "b2" | "convex";
  key: string | null;
  contentType: string;
  size: number;
  expiresAt: number;
}

export type StartedUpload =
  | { ok: true; method: "PUT" | "POST"; url: string; headers: Record<string, string>; ticket: string }
  | { ok: false; error: string };

export async function startVideoUpload(userId: Id<"users">, contentType: string, size: number): Promise<StartedUpload> {
  if (!VIDEO_TYPES.has(contentType)) return { ok: false, error: "Use an MP4, MOV or WebM video." };
  if (!Number.isInteger(size) || size <= 0) return { ok: false, error: "Empty file." };
  if (size > LIMITS.socialVideoBytes) {
    return { ok: false, error: `Videos must be ${LIMITS.socialVideoBytes / 1024 / 1024} MB or smaller.` };
  }
  const bucket = b2Bucket();
  try {
    await convex.mutation(api.media.beginUpload, { userId, backend: bucket ? "b2" : "convex" });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return { ok: false, error: message };
    throw error;
  }
  const base = { userId, contentType, size, expiresAt: Date.now() + TICKET_MS };
  if (bucket) {
    const key = bucket.newKey("video", contentType);
    const ticket = await seal(JSON.stringify({ ...base, backend: "b2", key } satisfies Ticket));
    const url = await bucket.presignPut(key, contentType);
    return { ok: true, method: "PUT", url, headers: { "content-type": contentType }, ticket };
  }
  const url = await convex.mutation(api.media.uploadUrl, {});
  const ticket = await seal(JSON.stringify({ ...base, backend: "convex", key: null } satisfies Ticket));
  return { ok: true, method: "POST", url, headers: { "content-type": contentType }, ticket };
}

export type FinishedUpload = { ok: true; id: Id<"media">; url: string | null } | { ok: false; error: string };

export async function finishVideoUpload(
  userId: Id<"users">,
  sealedTicket: string,
  storageId: string | null,
): Promise<FinishedUpload> {
  let ticket: Ticket;
  try {
    ticket = JSON.parse(await unseal(sealedTicket)) as Ticket;
  } catch {
    return { ok: false, error: "That upload expired. Add the video again." };
  }
  if (ticket.userId !== userId || ticket.expiresAt < Date.now()) {
    return { ok: false, error: "That upload expired. Add the video again." };
  }
  let location: MediaLocation;
  if (ticket.backend === "b2") {
    const bucket = b2Bucket();
    if (!bucket || !ticket.key) return { ok: false, error: "That upload didn't save. Try again." };
    const stored = await bucket.size(ticket.key);
    if (stored !== ticket.size) return { ok: false, error: "That upload didn't arrive whole. Try again." };
    location = { backend: "b2", key: ticket.key };
  } else {
    if (!storageId) return { ok: false, error: "That upload didn't save. Try again." };
    location = { backend: "convex", storageId: storageId as Id<"_storage"> };
  }
  let registered: { mediaId: Id<"media">; url: string | null };
  try {
    registered = await convex.mutation(api.media.register, {
      ownerId: userId,
      location,
      contentType: ticket.contentType,
      size: ticket.size,
      check: { verdict: "unchecked", reason: "Studio videos are checked with their post." },
    });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return { ok: false, error: message };
    throw error;
  }
  // The first bytes must be a video, whatever the browser said it was. A
  // refused upload stays unattached, and the sweep deletes it.
  if (registered.url) {
    const head = await fetch(registered.url, { headers: { range: "bytes=0-63" } }).catch(() => null);
    const bytes = head?.ok ? new Uint8Array(await head.arrayBuffer()).subarray(0, 64) : new Uint8Array();
    if (!sniffVideoType(bytes)) return { ok: false, error: "That file isn't a video we can post." };
  }
  return { ok: true, id: registered.mediaId, url: registered.url };
}
