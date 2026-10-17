---
slopper:
  type: feat
---

# Staff permissions in one table, and a staff log

- **Permissions, not roles.** `convex/lib/permissions.ts` maps each role to what it may do (`queue.decide`, `slops.hide`, `team.manage`, ...). Convex checks `requirePermission`, routes `requireStaff(viewer, request, permission)`, and loaders send `permissionsOf(user)` instead of the role, so a new role or a moved power is one change in that table. `canModerate`, `isAdmin` and `requireRole` are gone.
- **Staff log.** Every use of a staff power (role changes, queue decisions, takedowns, trust, hiding, and deleting someone else's slop or comment) is written to `staffActions` in the same mutation. Admins see the latest 50 at /mod/team. It never reaches a public shape.
