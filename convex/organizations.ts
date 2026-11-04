import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireServer } from "./lib/auth";

/**
 * Organisation accounts (`organizations` and `organizationMembers`).
 * Any member of an organisation can compose, schedule, and publish using the
 * organisation's shared social accounts (`accounts.organizationId`).
 */

export const orgRoleValidator = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));

export async function userOrganizationIds(ctx: QueryCtx, userId: Id<"users">): Promise<Set<Id<"organizations">>> {
  const memberships = await ctx.db
    .query("organizationMembers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const owned = await ctx.db
    .query("organizations")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  return new Set([...memberships.map((row) => row.organizationId), ...owned.map((row) => row._id)]);
}

export async function canAccessAccount(
  ctx: QueryCtx,
  userId: Id<"users">,
  account: Doc<"accounts"> | null | undefined,
): Promise<boolean> {
  if (!account) return false;
  if (account.userId === userId) return true;
  if (!account.organizationId) return false;
  const orgIds = await userOrganizationIds(ctx, userId);
  return orgIds.has(account.organizationId);
}

export async function canManageOrg(
  ctx: QueryCtx,
  userId: Id<"users">,
  organizationId: Id<"organizations">,
): Promise<boolean> {
  const org = await ctx.db.get(organizationId);
  if (!org) return false;
  if (org.ownerId === userId) return true;
  const membership = await ctx.db
    .query("organizationMembers")
    .withIndex("by_org_user", (q) => q.eq("organizationId", organizationId).eq("userId", userId))
    .unique();
  return membership?.role === "owner" || membership?.role === "admin";
}

function cleanSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export const list = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    const orgIds = await userOrganizationIds(ctx, userId);
    const out = [];
    for (const orgId of orgIds) {
      const org = await ctx.db.get(orgId);
      if (!org) continue;
      const memberRows = await ctx.db
        .query("organizationMembers")
        .withIndex("by_org", (q) => q.eq("organizationId", org._id))
        .collect();
      const members = [];
      let myRole: "owner" | "admin" | "member" = org.ownerId === userId ? "owner" : "member";
      for (const row of memberRows) {
        if (row.userId === userId) myRole = row.role;
        const user = await ctx.db.get(row.userId);
        if (user) {
          members.push({
            userId: user._id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            role: row.role,
          });
        }
      }
      const sharedAccounts = await ctx.db
        .query("accounts")
        .withIndex("by_org", (q) => q.eq("organizationId", org._id))
        .collect();
      out.push({
        id: org._id,
        name: org.name,
        slug: org.slug,
        bio: org.bio,
        website: org.website,
        avatarUrl: org.avatarUrl,
        role: myRole,
        members,
        accountCount: sharedAccounts.length,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const create = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    slug: v.optional(v.string()),
    bio: v.optional(v.string()),
    website: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { userId, name, slug: rawSlug, bio, website }) => {
    await requireServer(ctx);
    const cleanName = name.trim().slice(0, 60);
    if (!cleanName) throw new ConvexError("Give the organisation a name.");
    const slug = cleanSlug(rawSlug?.trim() || cleanName);
    if (slug.length < 2) throw new ConvexError("Give the organisation a handle of at least 2 characters.");
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existing) throw new ConvexError(`@${slug} is already taken by another organisation.`);

    const orgId = await ctx.db.insert("organizations", {
      name: cleanName,
      slug,
      ownerId: userId,
      avatarUrl: null,
      bio: (bio ?? "").trim().slice(0, 280),
      website: website?.trim() || null,
    });
    await ctx.db.insert("organizationMembers", {
      organizationId: orgId,
      userId,
      role: "owner",
    });
    return orgId;
  },
});

export const addMember = mutation({
  args: {
    actorId: v.id("users"),
    organizationId: v.string(),
    username: v.string(),
    role: v.optional(v.union(v.literal("admin"), v.literal("member"))),
  },
  handler: async (ctx, { actorId, organizationId: rawOrgId, username, role = "member" }) => {
    await requireServer(ctx);
    const orgId = ctx.db.normalizeId("organizations", rawOrgId);
    if (!orgId || !(await canManageOrg(ctx, actorId, orgId))) {
      throw new ConvexError("Only an organisation owner or admin can add members.");
    }
    const cleanUsername = username.trim().replace(/^@/, "").toLowerCase();
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", cleanUsername))
      .unique();
    if (!user) throw new ConvexError(`No Slopper user found with username @${cleanUsername}.`);

    const existing = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", user._id))
      .unique();
    if (existing) {
      if (existing.role !== "owner") await ctx.db.patch(existing._id, { role });
      return existing._id;
    }
    return await ctx.db.insert("organizationMembers", {
      organizationId: orgId,
      userId: user._id,
      role,
    });
  },
});

export const removeMember = mutation({
  args: {
    actorId: v.id("users"),
    organizationId: v.string(),
    memberUserId: v.string(),
  },
  handler: async (ctx, { actorId, organizationId: rawOrgId, memberUserId: rawUserId }) => {
    await requireServer(ctx);
    const orgId = ctx.db.normalizeId("organizations", rawOrgId);
    const targetUserId = ctx.db.normalizeId("users", rawUserId);
    if (!orgId || !targetUserId) return;
    const org = await ctx.db.get(orgId);
    if (!org) return;
    if (org.ownerId === targetUserId) {
      throw new ConvexError("The organisation owner can't be removed.");
    }
    if (actorId !== targetUserId && !(await canManageOrg(ctx, actorId, orgId))) {
      throw new ConvexError("Only an organisation owner or admin can remove members.");
    }
    const existing = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org_user", (q) => q.eq("organizationId", orgId).eq("userId", targetUserId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const remove = mutation({
  args: { actorId: v.id("users"), organizationId: v.string() },
  handler: async (ctx, { actorId, organizationId: rawOrgId }) => {
    await requireServer(ctx);
    const orgId = ctx.db.normalizeId("organizations", rawOrgId);
    const org = orgId ? await ctx.db.get(orgId) : null;
    if (!org || org.ownerId !== actorId) {
      throw new ConvexError("Only the organisation owner can delete the organisation.");
    }
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_org", (q) => q.eq("organizationId", org._id))
      .collect();
    for (const account of accounts) {
      await ctx.db.patch(account._id, { organizationId: undefined });
    }
    const members = await ctx.db
      .query("organizationMembers")
      .withIndex("by_org", (q) => q.eq("organizationId", org._id))
      .collect();
    for (const member of members) {
      await ctx.db.delete(member._id);
    }
    await ctx.db.delete(org._id);
  },
});
