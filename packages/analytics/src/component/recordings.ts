import { v } from "convex/values";
import { REPLAY_LIMITS } from "../shared/replay";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, type MutationCtx, query } from "./_generated/server";
import { INGEST_LIMITS } from "./lib/limits";
import { pageArgs, pageByKey } from "./lib/paging";
import { recordingDoc, sessionDoc } from "./shapes";

/**
 * Session recordings: chunks of rrweb events in file storage, as browsers
 * sent them, and one row per session saying what they add up to. Only the
 * player reads inside a chunk (shared/replay.ts has the wire format).
 */

const encodingValidator = v.union(v.literal("gzip"), v.literal("identity"));

const chunkMeta = {
  sessionId: v.string(),
  distinctId: v.string(),
  startedAt: v.number(),
  endedAt: v.number(),
  events: v.number(),
  encoding: encodingValidator,
};

/** Rows deleted per transaction. */
const PAGE = 200;

/** Bytes a session's recording can still take. */
export const room = internalQuery({
  args: { sessionId: v.string(), distinctId: v.string(), accountId: v.optional(v.string()) },
  returns: v.number(),
  handler: async (ctx, { sessionId, distinctId, accountId }) => {
    const link = await ctx.db
      .query("distinctIds")
      .withIndex("by_distinct_id", (q) => q.eq("distinctId", distinctId))
      .unique();
    const person = link ? await ctx.db.get(link.personId) : null;
    if (person?.identified && distinctId !== accountId) return 0;
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (session && session.personId !== person?._id) return 0;
    const recording = await ctx.db
      .query("recordings")
      .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
      .unique();
    return REPLAY_LIMITS.sessionBytes - (recording?.bytes ?? 0);
  },
});

/**
 * Stores one chunk as it came, for the app's HTTP route
 * (`Analytics.registerRoutes`). Says whether it was kept: an empty or
 * oversized chunk isn't, nor one past its session's limit.
 */
export const store = action({
  args: { ...chunkMeta, data: v.bytes(), accountId: v.optional(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, { data, accountId, ...meta }) => {
    if (data.byteLength === 0 || data.byteLength > REPLAY_LIMITS.chunkBytes) return false;
    // The route is public, so the deployment takes only so much a minute and
    // a day (`lib/limits.ts`): a flood hits the ceiling, not file storage.
    const chunk = await ctx.runMutation(internal.ingest.spend, {
      key: "replay:chunks:minute",
      amount: 1,
      cap: INGEST_LIMITS.replayChunksPerMinute,
      windowMs: 60_000,
    });
    if (chunk === 0) return false;
    const bytes = await ctx.runMutation(internal.ingest.spend, {
      key: "replay:bytes:day",
      amount: data.byteLength,
      cap: INGEST_LIMITS.replayBytesPerDay,
      windowMs: 86_400_000,
    });
    if (bytes < data.byteLength) return false;
    const room = await ctx.runQuery(internal.recordings.room, {
      sessionId: meta.sessionId,
      distinctId: meta.distinctId,
      accountId,
    });
    if (room < data.byteLength) return false;
    const type = meta.encoding === "gzip" ? "application/gzip" : "application/json";
    const storageId = await ctx.storage.store(new Blob([data], { type }));
    await ctx.runMutation(internal.recordings.addChunk, { ...meta, storageId, bytes: data.byteLength });
    return true;
  },
});

export const addChunk = internalMutation({
  args: { ...chunkMeta, storageId: v.id("_storage"), bytes: v.number() },
  returns: v.null(),
  handler: async (ctx, chunk) => {
    await ctx.db.insert("recordingChunks", {
      sessionId: chunk.sessionId,
      distinctId: chunk.distinctId,
      storageId: chunk.storageId,
      startedAt: chunk.startedAt,
      endedAt: chunk.endedAt,
      bytes: chunk.bytes,
      encoding: chunk.encoding,
    });
    const recording = await ctx.db
      .query("recordings")
      .withIndex("by_session_id", (q) => q.eq("sessionId", chunk.sessionId))
      .unique();
    if (recording) {
      await ctx.db.patch(recording._id, {
        startedAt: Math.min(recording.startedAt, chunk.startedAt),
        endedAt: Math.max(recording.endedAt, chunk.endedAt),
        chunks: recording.chunks + 1,
        bytes: recording.bytes + chunk.bytes,
        events: recording.events + chunk.events,
      });
    } else {
      await ctx.db.insert("recordings", {
        sessionId: chunk.sessionId,
        distinctId: chunk.distinctId,
        startedAt: chunk.startedAt,
        endedAt: chunk.endedAt,
        chunks: 1,
        bytes: chunk.bytes,
        events: chunk.events,
      });
    }
    return null;
  },
});

const chunkUrl = v.object({
  url: v.string(),
  encoding: encodingValidator,
  startedAt: v.number(),
  endedAt: v.number(),
  bytes: v.number(),
});

/** A session's recording and where to fetch its chunks, in order; null when there's none. */
export const get = query({
  args: { sessionId: v.string() },
  returns: v.union(v.object({ recording: recordingDoc, chunks: v.array(chunkUrl) }), v.null()),
  handler: async (ctx, { sessionId }) => {
    const recording = await ctx.db
      .query("recordings")
      .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!recording) return null;
    const rows = await ctx.db
      .query("recordingChunks")
      .withIndex("by_session_started", (q) => q.eq("sessionId", sessionId))
      .collect();
    const chunks = [];
    for (const row of rows) {
      const url = await ctx.storage.getUrl(row.storageId);
      if (url) {
        chunks.push({
          url,
          encoding: row.encoding,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          bytes: row.bytes,
        });
      }
    }
    return { recording, chunks };
  },
});

/** Recordings, newest first, each with its session (null once the session is gone). */
export const list = query({
  args: pageArgs,
  returns: v.object({
    page: v.array(v.object({ recording: recordingDoc, session: v.union(sessionDoc, v.null()) })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor, numItems }) => {
    const recordings = () => ctx.db.query("recordings");
    const result = await pageByKey<Doc<"recordings">>({
      cursor,
      numItems,
      key: (recording) => recording.startedAt,
      sameKey: (at) =>
        recordings()
          .withIndex("by_started", (q) => q.eq("startedAt", at.key).lt("_creationTime", at.created))
          .order("desc"),
      rest: (at) =>
        recordings()
          .withIndex("by_started", (q) => (at ? q.lt("startedAt", at.key) : q))
          .order("desc"),
    });
    const page = [];
    for (const recording of result.page) {
      const session = await ctx.db
        .query("sessions")
        .withIndex("by_session_id", (q) => q.eq("sessionId", recording.sessionId))
        .unique();
      page.push({ recording, session });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** Which of these sessions were recorded. */
export const recorded = query({
  args: { sessionIds: v.array(v.string()) },
  returns: v.array(v.string()),
  handler: async (ctx, { sessionIds }) => {
    const found: string[] = [];
    for (const sessionId of sessionIds.slice(0, 200)) {
      const recording = await ctx.db
        .query("recordings")
        .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
        .unique();
      if (recording) found.push(sessionId);
    }
    return found;
  },
});

async function deleteChunk(ctx: MutationCtx, chunk: Doc<"recordingChunks">): Promise<void> {
  await ctx.storage.delete(chunk.storageId);
  await ctx.db.delete(chunk._id);
}

/** Deletes a page of what was recorded from these distinct ids; true when nothing is left. */
async function forgetSome(ctx: MutationCtx, distinctIds: readonly string[]): Promise<boolean> {
  let done = true;
  for (const distinctId of distinctIds) {
    const chunks = await ctx.db
      .query("recordingChunks")
      .withIndex("by_distinct_id", (q) => q.eq("distinctId", distinctId))
      .take(PAGE);
    const sessions = new Set<string>();
    for (const chunk of chunks) {
      sessions.add(chunk.sessionId);
      await deleteChunk(ctx, chunk);
    }
    // A session that was recorded from them goes whole, whoever its first chunk came from.
    for (const sessionId of sessions) {
      const recording = await ctx.db
        .query("recordings")
        .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
        .unique();
      if (recording) await ctx.db.delete(recording._id);
    }
    const recordings = await ctx.db
      .query("recordings")
      .withIndex("by_distinct_id", (q) => q.eq("distinctId", distinctId))
      .take(PAGE);
    for (const recording of recordings) await ctx.db.delete(recording._id);
    if (chunks.length === PAGE || recordings.length === PAGE) done = false;
  }
  return done;
}

/** Deletes everything recorded from these distinct ids, a page at a time (persons.forget calls it). */
export const forget = internalMutation({
  args: { distinctIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { distinctIds }) => {
    if (!(await forgetSome(ctx, distinctIds))) {
      await ctx.scheduler.runAfter(0, internal.recordings.forget, { distinctIds });
    }
    return null;
  },
});

/** Deletes a page of recordings that started before `cutoff`; says whether there may be more. */
export async function sweepRecordings(ctx: MutationCtx, cutoff: number): Promise<{ deleted: number; more: boolean }> {
  const chunks = await ctx.db
    .query("recordingChunks")
    .withIndex("by_started", (q) => q.lt("startedAt", cutoff))
    .take(PAGE);
  for (const chunk of chunks) await deleteChunk(ctx, chunk);
  const recordings = await ctx.db
    .query("recordings")
    .withIndex("by_started", (q) => q.lt("startedAt", cutoff))
    .take(PAGE);
  for (const recording of recordings) await ctx.db.delete(recording._id);
  return {
    deleted: chunks.length + recordings.length,
    more: chunks.length === PAGE || recordings.length === PAGE,
  };
}
