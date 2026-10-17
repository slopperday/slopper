import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireRole, requireServer, type StaffRole } from "./lib/auth";
import { staffRoleValidator } from "./schema";

/**
 * The moderation team. Moderators approve or reject what waits in the flag
 * and video queues at /mod, and nothing else. Admins do that too, plus the
 * rest: the team at /mod/team, trusting uploaders, and taking down anyone's
 * slops, videos and comments (see `canModerate` and `isAdmin` in lib/auth.ts).
 * The app server checks roles before it calls anything here, and every write
 * checks the acting admin's stored role again.
 *
 * ADMIN_USERNAMES (app server config) bootstraps the team: people listed
 * there are made admins the next time they load a page (`bootstrap`), and the
 * server won't let anyone demote them while they're listed.
 */

export interface TeamMember {
  id: Id<"users">;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: StaffRole | null;
}

function member(user: Doc<"users">): TeamMember {
  return {
    id: user._id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role ?? null,
  };
}

/** Everyone on the team: admins first, then moderators, by username. */
export const members = query({
  args: {},
  handler: async (ctx): Promise<TeamMember[]> => {
    await requireServer(ctx);
    const team: TeamMember[] = [];
    for (const role of ["admin", "moderator"] as const) {
      const people = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", role))
        .collect();
      team.push(...people.map(member).sort((a, b) => a.username.localeCompare(b.username)));
    }
    return team;
  },
});

/** Accounts whose username starts with `prefix` (an @ is ignored), for promoting. */
export const search = query({
  args: { prefix: v.string() },
  handler: async (ctx, { prefix }): Promise<TeamMember[]> => {
    await requireServer(ctx);
    const start = prefix.trim().replace(/^@/, "").toLowerCase();
    if (!start) return [];
    const people = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.gte("username", start).lt("username", `${start}￿`))
      .take(10);
    return people.map(member);
  },
});

/** Makes someone listed in ADMIN_USERNAMES an admin. The app server calls it once, when it sees them. */
export const bootstrap = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    const user = await ctx.db.get(userId);
    if (user && user.role !== "admin") await ctx.db.patch(userId, { role: "admin" });
  },
});

/**
 * An admin puts someone on the team, changes their role, or (with null)
 * takes them off it. Slopper always keeps at least one admin.
 */
export const setRole = mutation({
  args: { adminId: v.id("users"), username: v.string(), role: v.union(staffRoleValidator, v.null()) },
  handler: async (ctx, { adminId, username, role }): Promise<TeamMember> => {
    await requireServer(ctx);
    await requireRole(ctx, adminId, "admin");
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username.trim().replace(/^@/, "").toLowerCase()))
      .unique();
    if (!user) throw new ConvexError("There's no account with that username.");
    if (user.role === "admin" && role !== "admin") {
      const admins = await ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", "admin"))
        .take(2);
      if (admins.length < 2)
        throw new ConvexError("Slopper needs at least one admin. Make someone else an admin first.");
    }
    await ctx.db.patch(user._id, { role: role ?? undefined });
    return { ...member(user), role };
  },
});
