---
slopper:
  type: feat
---

# Reviews, checked before they're saved

- **Reviews** (convex/reviews.ts): one per person per launch, replaced when written again; not for the maker's own slop or a hidden one. Screenshots must be the reviewer's own uploads, and a mature one makes the review mature (blurred for people who haven't opted in to NSFW).
- **postReview** (app/.server/reviews.ts) runs the content check on the text and screenshots first: blocked is refused and never saved, ok and mature go up at once, and when the check can't run the review is saved as unchecked, like uploads. No moderator queue.
- Authors and admins (new reviews.deleteAny permission, logged as deleteReview) can delete a review; makers can't. releaseMedia and slop deletion know about review screenshots.
- New notification kind review, counted in the daily digest. Analytics event reviewed, shown to makers.
- Agents: review_slop and list_reviews operations, PUT /api/v1/slops/:slop/reviews/mine and GET /api/v1/slops/:slop/reviews.
