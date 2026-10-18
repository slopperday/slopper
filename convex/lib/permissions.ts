import { ConvexError, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { staffRoleValidator } from "../schema";

/**
 * What the moderation team may do. Code asks whether someone has a
 * permission (`can(user, "slops.hide")`), never which role they hold, so the
 * table below is the one place that says who does what: a new role, or a
 * power moved from one role to another, is a change here and nowhere else.
 *
 * Roles are stored on `users.role` (convex/team.ts) and never go into a
 * public shape. Every staff write names the person acting, and Convex checks
 * their stored role with `requirePermission`, whatever the caller saw.
 */

export type StaffRole = Infer<typeof staffRoleValidator>;

export type Permission =
  /** Approve or reject queued promo videos and flagged slops. */
  | "queue.decide"
  /**
   * Decide on your own queued slops too. Without it, approving your own video
   * would trust you, and clearing your own flags would restart its auto-posts.
   */
  | "queue.decideOwn"
  /** See hidden slops, to judge them. */
  | "slops.viewHidden"
  /** Hide or unhide any slop. */
  | "slops.hide"
  /** Delete anyone's slop. */
  | "slops.deleteAny"
  /** Delete anyone's comment. */
  | "comments.deleteAny"
  /** Take down a video the video check let through. */
  | "videos.takeDown"
  /** Revoke or restore a maker's video trust. */
  | "videos.trust"
  /** Put people on the team, change their roles, and read the staff log. */
  | "team.manage"
  /** See analytics: who visits, what they do, people's histories. */
  | "analytics.view"
  /** Change what analytics does and keeps: forget a person. */
  | "analytics.manage";

const MODERATOR: readonly Permission[] = ["queue.decide", "slops.viewHidden"];

/** Each role and what it may do, lowest first. */
const ROLES: Record<StaffRole, { plural: string; permissions: ReadonlySet<Permission> }> = {
  moderator: { plural: "moderators", permissions: new Set(MODERATOR) },
  admin: {
    plural: "admins",
    permissions: new Set<Permission>([
      ...MODERATOR,
      "queue.decideOwn",
      "slops.hide",
      "slops.deleteAny",
      "comments.deleteAny",
      "videos.takeDown",
      "videos.trust",
      "team.manage",
      "analytics.view",
      "analytics.manage",
    ]),
  },
};

export function can(user: Doc<"users"> | null, permission: Permission): boolean {
  return user?.role !== undefined && ROLES[user.role].permissions.has(permission);
}

/** Everything this person may do, for pages that show or hide staff controls. */
export function permissionsOf(user: Doc<"users"> | null): Permission[] {
  return user?.role === undefined ? [] : [...ROLES[user.role].permissions];
}

/**
 * The staff member making a write, checked against their stored role. The
 * app server checks first; this makes a role that was just taken away stop
 * working at once, whatever the server saw when the page loaded.
 */
export async function requirePermission(
  ctx: QueryCtx,
  userId: Id<"users">,
  permission: Permission,
): Promise<Doc<"users">> {
  const user = await ctx.db.get(userId);
  if (!user || !can(user, permission)) {
    const holder = Object.values(ROLES).find((role) => role.permissions.has(permission));
    throw new ConvexError(`Only ${holder?.plural ?? "admins"} can do that.`);
  }
  return user;
}

/** Whether this staff member may decide on a queued video or flagged slop of `ownerId`'s. */
export function mayJudge(moderator: Doc<"users">, ownerId: Id<"users">): boolean {
  return can(moderator, "queue.decide") && (ownerId !== moderator._id || can(moderator, "queue.decideOwn"));
}

/** Refuses a queue decision on the moderator's own slop unless their role allows it. */
export function requireMayJudge(moderator: Doc<"users">, slop: Doc<"slops">): void {
  if (!mayJudge(moderator, slop.userId)) {
    throw new ConvexError("That's your slop, so another moderator decides on it.");
  }
}
