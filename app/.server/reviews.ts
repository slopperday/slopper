import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { REVIEW_EXPERIENCES } from "~/lib/model";
import { convex, type ConvexCaller } from "./convex";
import type { ReviewForm } from "./forms";
import { type ContentCheck, reviewSubmission, type Submission, tryCheck } from "./moderation";

export const BLOCKED_REVIEW = "This review can't go on Slopper. Keep it about the app, and keep it civil.";

export type PostedReview =
  | { ok: true; reviewId: Id<"reviews">; created: boolean; orphaned: number }
  | { ok: false; error: string };

/** What posting a review talks to. Tests swap in fakes. */
export interface ReviewServices {
  convex: ConvexCaller;
  check: (submission: Submission) => Promise<ContentCheck | null>;
}

const defaultServices = (): ReviewServices => ({ convex, check: (submission) => tryCheck(submission) });

/**
 * Posts a validated review (`validateReview`). The slop page, the REST API
 * and MCP all post through here.
 *
 * The content check reads it first, with its screenshots: a blocked review
 * is refused and nothing is saved; an ok or mature one goes up at once, with
 * no moderator in between (mature ones are blurred for people who haven't
 * opted in to NSFW). When the check can't run, the review goes up as
 * "unchecked", the same tradeoff as uploads (app/.server/media.ts): its
 * screenshots were checked as they were uploaded, and admins can delete it.
 */
export async function postReview(
  userId: Id<"users">,
  slop: { id: Id<"slops">; name: string },
  review: ReviewForm,
  services: ReviewServices = defaultServices(),
): Promise<PostedReview> {
  const urls = await Promise.all(review.images.map((mediaId) => services.convex.query(api.media.url, { mediaId })));
  const result = await services.check(
    reviewSubmission(
      { slopName: slop.name, experience: REVIEW_EXPERIENCES[review.experience].label, body: review.body },
      urls.filter((url): url is string => url !== null),
    ),
  );
  if (result?.verdict === "blocked") {
    console.warn(`Refused a review from ${userId}: ${result.reason}`);
    return { ok: false, error: BLOCKED_REVIEW };
  }
  const saved = await services.convex.mutation(api.reviews.save, {
    userId,
    slopId: slop.id,
    experience: review.experience,
    body: review.body,
    images: review.images,
    check: result
      ? { verdict: result.verdict === "mature" ? "mature" : "ok", reason: result.reason }
      : { verdict: "unchecked", reason: "The content check couldn't run." },
  });
  return { ok: true, ...saved };
}
