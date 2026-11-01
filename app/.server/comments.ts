import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { convex, type ConvexCaller } from "./convex";
import { type ContentCheck, commentSubmission, type Submission, tryCheck } from "./moderation";

export const BLOCKED_COMMENT = "This comment can't go on Slopper. Keep it about the slop, and keep it civil.";

export type PostedComment = { ok: true; commentId: Id<"comments">; held: boolean } | { ok: false; error: string };

/** What posting a comment talks to. Tests swap in fakes. */
export interface CommentServices {
  convex: ConvexCaller;
  check: (submission: Submission) => Promise<ContentCheck | null>;
}

const defaultServices = (): CommentServices => ({ convex, check: (submission) => tryCheck(submission) });

/**
 * Posts a validated comment (the slop page action in `app/routes/slop.tsx`).
 *
 * A commenter a moderator has already trusted skips the check and the hourly
 * cap. Everyone else's comment is checked first: blocked is refused and never
 * saved, "ok" goes up at once, and anything else (mature, or the check not
 * running) waits hidden for a moderator. The app server charges the attempt
 * through `beginComment` before checking, so blocked comments still count.
 */
export async function postComment(
  userId: Id<"users">,
  slop: { id: Id<"slops">; name: string },
  comment: { kind: "feedback" | "kudos"; body: string },
  services: CommentServices = defaultServices(),
): Promise<PostedComment> {
  const { trusted } = await services.convex.mutation(api.activity.beginComment, {
    userId,
    slopId: slop.id,
  });
  if (trusted) {
    const commentId = await services.convex.mutation(api.activity.addComment, {
      userId,
      slopId: slop.id,
      kind: comment.kind,
      body: comment.body,
    });
    return { ok: true, commentId, held: false };
  }

  const result = await services.check(
    commentSubmission({ slopName: slop.name, kind: comment.kind, body: comment.body }),
  );
  if (result?.verdict === "blocked") {
    console.warn(`Refused a comment from ${userId}: ${result.reason}`);
    return { ok: false, error: BLOCKED_COMMENT };
  }
  const check = result
    ? { verdict: result.verdict, reason: result.reason }
    : { verdict: "unchecked" as const, reason: "The content check couldn't run." };
  const commentId = await services.convex.mutation(api.activity.addComment, {
    userId,
    slopId: slop.id,
    kind: comment.kind,
    body: comment.body,
    check,
  });
  return { ok: true, commentId, held: check.verdict !== "ok" };
}
