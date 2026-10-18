---
slopper:
  type: refactor
---

# Drop the old admin flags from Convex

`slops.page`, `slops.remove` and `activity.deleteComment` no longer accept the `isAdmin`/`asAdmin` arguments they ignored while v1.6.0 deployed. They read the caller's stored role (`canModerate`/`isAdmin` in `convex/lib/auth.ts`), and no app server since v1.6.0 sends them.
