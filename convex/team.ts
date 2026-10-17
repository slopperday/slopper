import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { requirePermission, type StaffRole } from "./lib/permissions";
import { logStaffAction, type StaffAction } from "./lib/staffLog";
import { signInIdentityValidator, staffRoleValidator } from "./schema";
import { typedUsername } from "../app/lib/username";

/**
 * The moderation team. Moderators approve or reject what waits in the flag
 * and video queues at /mod, and nothing else. Admins do that too, plus the
 * rest: the team at /mod/team, trusting uploaders, and taking down anyone's
 * slops, videos and comments (the table in lib/permissions.ts). The app server
 * checks permissions before it calls anything here, and every write checks
 * the acting admin's stored role again.
 *
 * ADMIN_IDENTITIES (app server config) bootstraps the team: sign-in accounts
 * listed there, like `github:1160934`, make whoever holds them an admin when
 * they sign in (`bootstrap`), and the server won't let anyone demote them
 * while they're listed. It names sign-in accounts, not usernames, because
 * anyone can take a username nobody holds.
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
    const start = typedUsername(prefix);
    if (!start) return [];
    const people = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.gte("username", start).lt("username", `${start}￿`))
      .take(10);
    return people.map(member);
  },
});

/** The account that signs in with this provider account, if any. */
async function holderOf(ctx: QueryCtx, provider: string, providerId: string): Promise<Doc<"users"> | null> {
  const identity = await ctx.db
    .query("identities")
    .withIndex("by_provider_id", (q) => q.eq("provider", provider).eq("providerId", providerId))
    .unique();
  return identity ? await ctx.db.get(identity.userId) : null;
}

/**
 * Makes whoever signs in with a sign-in account listed in ADMIN_IDENTITIES an
 * admin. The app server calls it when they sign in or link that account.
 */
export const bootstrap = mutation({
  args: signInIdentityValidator,
  handler: async (ctx, { provider, providerId }) => {
    await requireServer(ctx);
    const user = await holderOf(ctx, provider, providerId);
    if (!user || user.role === "admin") return;
    await ctx.db.patch(user._id, { role: "admin" });
    await logStaffAction(ctx, user._id, { type: "listedAdmin", userId: user._id }, user);
  },
});

/** The accounts that sign in with any of `identities` (ADMIN_IDENTITIES), so /mod/team can keep them admins. */
export const listed = query({
  args: { identities: v.array(signInIdentityValidator) },
  handler: async (ctx, { identities }): Promise<{ id: Id<"users">; username: string }[]> => {
    await requireServer(ctx);
    const holders = await Promise.all(
      identities.map(({ provider, providerId }) => holderOf(ctx, provider, providerId)),
    );
    return holders.filter((user) => user !== null).map((user) => ({ id: user._id, username: user.username }));
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
    await requirePermission(ctx, adminId, "team.manage");
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", typedUsername(username)))
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
    if ((user.role ?? null) !== role) {
      await ctx.db.patch(user._id, { role: role ?? undefined });
      await logStaffAction(ctx, adminId, { type: "role", userId: user._id, role }, user);
    }
    return { ...member(user), role };
  },
});

export interface StaffLogEntry {
  id: Id<"staffActions">;
  at: number;
  /** Who did it: their username now, or null for a deleted account. */
  actor: string | null;
  action: StaffAction;
  target: string;
}

/** The latest 50 entries in the staff log, newest first, for admins at /mod/team. */
export const log = query({
  args: {},
  handler: async (ctx): Promise<StaffLogEntry[]> => {
    await requireServer(ctx);
    const rows = await ctx.db.query("staffActions").order("desc").take(50);
    return await Promise.all(
      rows.map(async (row) => ({
        id: row._id,
        at: row._creationTime,
        actor: (await ctx.db.get(row.actorId))?.username ?? null,
        action: row.action,
        target: row.target,
      })),
    );
  },
});
