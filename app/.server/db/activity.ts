import type { Kv, KvKey } from "@deno/kv";
import type { Comment, CommentKind, CrosspostResult, Slop, SlopUpdate, UpdateKind } from "~/lib/model";
import { getManyValues, listValues, newId, present, withRetry } from "../kv";

/**
 * Posts an update to a slop. Updates bump the slop's last activity so
 * re-served slops float back up the feeds.
 */
export async function addUpdate(
  kv: Kv,
  slopId: string,
  userId: string,
  kind: Exclude<UpdateKind, "launch">,
  body: string,
): Promise<SlopUpdate> {
  return await withRetry(async () => {
    const entry = await kv.get<Slop>(["slop", slopId]);
    if (!entry.value) throw new Error(`Slop ${slopId} not found`);
    const update: SlopUpdate = {
      id: newId(),
      slopId,
      userId,
      kind,
      body,
      crossposts: [],
      createdAt: new Date().toISOString(),
    };
    const result = await kv
      .atomic()
      .check(entry)
      .set(["slop", slopId], {
        ...entry.value,
        updateCount: entry.value.updateCount + 1,
        fieldTests: entry.value.fieldTests + (kind === "field" ? 1 : 0),
        lastActivityAt: update.createdAt,
      })
      .set(["update", slopId, update.id], update)
      .set(["updates_by_time", update.id], slopId)
      .commit();
    return result.ok ? update : null;
  });
}

export async function getUpdate(kv: Kv, slopId: string, updateId: string): Promise<SlopUpdate | null> {
  return (await kv.get<SlopUpdate>(["update", slopId, updateId])).value;
}

export async function saveCrossposts(
  kv: Kv,
  slopId: string,
  updateId: string,
  crossposts: CrosspostResult[],
): Promise<void> {
  await withRetry(async () => {
    const entry = await kv.get<SlopUpdate>(["update", slopId, updateId]);
    if (!entry.value) return true;
    const result = await kv
      .atomic()
      .check(entry)
      .set(entry.key, { ...entry.value, crossposts })
      .commit();
    return result.ok ? true : null;
  });
}

export async function deleteUpdate(kv: Kv, update: SlopUpdate): Promise<void> {
  await withRetry(async () => {
    const entry = await kv.get<Slop>(["slop", update.slopId]);
    const op = kv
      .atomic()
      .check(entry)
      .delete(["update", update.slopId, update.id])
      .delete(["updates_by_time", update.id]);
    if (entry.value) {
      op.set(entry.key, {
        ...entry.value,
        updateCount: Math.max(0, entry.value.updateCount - 1),
        fieldTests: Math.max(0, entry.value.fieldTests - (update.kind === "field" ? 1 : 0)),
      });
    }
    return (await op.commit()).ok ? true : null;
  });
}

export function listSlopUpdates(kv: Kv, slopId: string): Promise<SlopUpdate[]> {
  return listValues<SlopUpdate>(
    kv,
    { prefix: ["update", slopId] },
    {
      reverse: true,
    },
  );
}

/** The latest updates across every slop, newest first. */
export async function listRecentUpdates(kv: Kv, limit = 20): Promise<SlopUpdate[]> {
  const refs: KvKey[] = [];
  for await (const entry of kv.list<string>(
    { prefix: ["updates_by_time"] },
    {
      reverse: true,
      limit,
    },
  )) {
    refs.push(["update", entry.value, entry.key[1] as string]);
  }
  return (await getManyValues<SlopUpdate>(kv, refs)).filter(present);
}

export async function addComment(
  kv: Kv,
  slopId: string,
  userId: string,
  kind: CommentKind,
  body: string,
): Promise<Comment> {
  return await withRetry(async () => {
    const entry = await kv.get<Slop>(["slop", slopId]);
    if (!entry.value) throw new Error(`Slop ${slopId} not found`);
    const comment: Comment = {
      id: newId(),
      slopId,
      userId,
      kind,
      body,
      createdAt: new Date().toISOString(),
    };
    const result = await kv
      .atomic()
      .check(entry)
      .set(entry.key, {
        ...entry.value,
        commentCount: entry.value.commentCount + 1,
      })
      .set(["comment", slopId, comment.id], comment)
      .commit();
    return result.ok ? comment : null;
  });
}

export async function getComment(kv: Kv, slopId: string, commentId: string): Promise<Comment | null> {
  return (await kv.get<Comment>(["comment", slopId, commentId])).value;
}

export async function deleteComment(kv: Kv, comment: Comment): Promise<void> {
  await withRetry(async () => {
    const entry = await kv.get<Slop>(["slop", comment.slopId]);
    const op = kv.atomic().check(entry).delete(["comment", comment.slopId, comment.id]);
    if (entry.value) {
      op.set(entry.key, {
        ...entry.value,
        commentCount: Math.max(0, entry.value.commentCount - 1),
      });
    }
    return (await op.commit()).ok ? true : null;
  });
}

/** Comments oldest first, so conversations read top to bottom. */
export function listComments(kv: Kv, slopId: string): Promise<Comment[]> {
  return listValues<Comment>(kv, { prefix: ["comment", slopId] });
}
