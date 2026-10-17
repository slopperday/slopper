---
slopper:
  type: feat
---

# Moderator and admin roles, and an automatic video check

- **Roles live in Convex** (`users.role`, `convex/team.ts`): moderators only approve or reject what's queued at /mod (videos and flagged slops); admins also manage the team at /mod/team, revoke or restore video trust, take down videos the check let through, hide or unhide slops from their page, and delete anyone's slops and comments. Every moderation write names its moderator or admin, and Convex checks their stored role (`requireRole`). `slops.page`, `slops.remove` and `activity.deleteComment` read the caller's role instead of trusting an `isAdmin`/`asAdmin` argument, which also stops a browser from asking `slops.page` for hidden slops.
- **ADMIN_USERNAMES bootstraps admins**: the app server stores the role the first time it sees a listed person (`team.bootstrap`), and won't let anyone demote them while they're listed. Convex never lets the last admin go.
- **Trusted makers** (`videoTrust`): a moderator's first approval of someone's video trusts them; a revoke sticks until an admin restores it. A trusted maker's new video goes past `checkVideo` (`app/.server/moderation.ts`) as it's set: the same policy prompt, with the video sent inline as `video_url` to `OPENROUTER_VIDEO_MODEL` (default `google/gemini-3.1-flash-lite` on `OPENROUTER_VIDEO_PROVIDER`, default `google-ai-studio`) through the existing `OPENROUTER_API_KEY`. A pass plays at once; anything else stays in `videoReviews`. Every automatic decision is recorded in `videoChecks` (verdict, reason, model, provider, time) and shown to admins at /mod.
- **Moderators decide on the video they watched**: `videos.decide` takes the media id, so a replacement uploaded meanwhile waits for its own review.
