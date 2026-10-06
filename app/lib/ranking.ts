/** What ranking needs from a slop. */
export interface Rankable {
  upvotes: number;
  downvotes: number;
  commentCount: number;
  updateCount: number;
  fieldTests: number;
  lastActivityAt: number;
}

/**
 * Hot ranking. Downvotes are never displayed but they do cost points.
 * Feedback, fresh updates and real-world field tests keep a slop warm, and
 * getting it in front of real people earns the most. Recent activity, not the
 * launch date, drives decay, so a re-promoted slop gets another shot.
 */
export function hotScore(slop: Rankable, now: Date): number {
  const points =
    slop.upvotes - slop.downvotes + 0.5 * slop.commentCount + 0.25 * (slop.updateCount - 1) + 0.75 * slop.fieldTests;
  const hours = Math.max(0, (now.getTime() - slop.lastActivityAt) / 3_600_000);
  return (points + 1) / Math.pow(hours + 2, 1.4);
}

export function rankHot<T extends Rankable>(slops: readonly T[], now: Date): T[] {
  return [...slops].sort((a, b) => hotScore(b, now) - hotScore(a, now));
}
