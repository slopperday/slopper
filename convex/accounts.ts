import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { canAccessAccount, userOrganizationIds } from "./organizations";
import { socialProviderValidator } from "./schema";
import { NETWORKS } from "../app/lib/networks";

/** Connected social accounts. Credentials arrive sealed by the app server. */

const mode = v.union(v.literal("post"), v.literal("amplify"), v.literal("off"));
const provider = socialProviderValidator;

export const list = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Doc<"accounts">[]> => {
    await requireServer(ctx);
    const mine = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const orgIds = await userOrganizationIds(ctx, userId);
    const seen = new Set(mine.map((account) => account._id));
    const shared: Doc<"accounts">[] = [];
    for (const orgId of orgIds) {
      const rows = await ctx.db
        .query("accounts")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .collect();
      for (const row of rows) {
        if (!seen.has(row._id)) {
          seen.add(row._id);
          shared.push(row);
        }
      }
    }
    return [...mine, ...shared];
  },
});

/**
 * Connects an account, or refreshes the credentials when the same remote
 * account is connected again (LinkedIn's 60 day reconnect).
 */
export const connect = mutation({
  args: {
    userId: v.id("users"),
    provider,
    remoteId: v.string(),
    handle: v.string(),
    displayName: v.string(),
    avatarUrl: v.union(v.string(), v.null()),
    sealedCredentials: v.string(),
    expiresAt: v.union(v.string(), v.null()),
    initialMode: v.optional(mode),
    brand: v.optional(v.string()),
    organizationId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { initialMode, organizationId: rawOrgId, brand: rawBrand, ...args },
  ): Promise<Doc<"accounts">> => {
    await requireServer(ctx);
    const orgIds = await userOrganizationIds(ctx, args.userId);
    const normOrgId = rawOrgId ? ctx.db.normalizeId("organizations", rawOrgId) : null;
    const organizationId: Id<"organizations"> | undefined = normOrgId && orgIds.has(normOrgId) ? normOrgId : undefined;
    const brand = rawBrand?.trim().replace(/\s+/g, " ").slice(0, 40) || undefined;

    let existing = await ctx.db
      .query("accounts")
      .withIndex("by_user_remote", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider).eq("remoteId", args.remoteId),
      )
      .unique();
    if (!existing && organizationId) {
      const orgAccounts = await ctx.db
        .query("accounts")
        .withIndex("by_org", (q) => q.eq("organizationId", organizationId))
        .collect();
      existing = orgAccounts.find((row) => row.provider === args.provider && row.remoteId === args.remoteId) ?? null;
    }
    if (existing) {
      // Reconnecting refreshes the credentials; brand and organisation update only when explicitly given.
      const patch = {
        ...args,
        ...(brand !== undefined ? { brand } : {}),
        ...(organizationId !== undefined ? { organizationId } : {}),
        broken: undefined,
      };
      await ctx.db.patch(existing._id, patch);
      return { ...existing, ...patch };
    }
    const siblings = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    // A person's first account on a network posts; extra ones repost where
    // the network can, and stay off where it can't, so a new brand's Page
    // never gets another product's posts.
    const second = siblings.some((account) => account.provider === args.provider);
    const defaultMode = initialMode ?? (!second ? "post" : NETWORKS[args.provider].canRepost ? "amplify" : "off");
    const id = await ctx.db.insert("accounts", {
      ...args,
      defaultMode,
      ...(brand ? { brand } : {}),
      ...(organizationId ? { organizationId } : {}),
    });
    const account = await ctx.db.get(id);
    if (!account) throw new Error("Account vanished after insert");
    return account;
  },
});

export const storeCredentials = mutation({
  args: { accountId: v.id("accounts"), sealedCredentials: v.string() },
  handler: async (ctx, { accountId, sealedCredentials }) => {
    await requireServer(ctx);
    await ctx.db.patch(accountId, { sealedCredentials });
  },
});

export const setDefaultMode = mutation({
  args: { userId: v.id("users"), accountId: v.string(), mode },
  handler: async (ctx, { userId, accountId, mode: next }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("accounts", accountId);
    const account = id ? await ctx.db.get(id) : null;
    if (!(await canAccessAccount(ctx, userId, account)) || !account) return;
    if (next === "amplify" && !NETWORKS[account.provider].canRepost) return;
    await ctx.db.patch(account._id, { defaultMode: next });
  },
});

export const setOrganization = mutation({
  args: { userId: v.id("users"), accountId: v.string(), organizationId: v.union(v.string(), v.null()) },
  handler: async (ctx, { userId, accountId, organizationId: rawOrgId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("accounts", accountId);
    const account = id ? await ctx.db.get(id) : null;
    if (!(await canAccessAccount(ctx, userId, account)) || !account) return;
    if (!rawOrgId) {
      await ctx.db.patch(account._id, { organizationId: undefined });
      return;
    }
    const orgId = ctx.db.normalizeId("organizations", rawOrgId);
    const orgIds = await userOrganizationIds(ctx, userId);
    if (orgId && orgIds.has(orgId)) {
      await ctx.db.patch(account._id, { organizationId: orgId });
    }
  },
});

export const disconnect = mutation({
  args: { userId: v.id("users"), accountId: v.string() },
  handler: async (ctx, { userId, accountId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("accounts", accountId);
    const account = id ? await ctx.db.get(id) : null;
    if (account && (await canAccessAccount(ctx, userId, account))) await ctx.db.delete(account._id);
  },
});

/** Names the brand an account speaks for; empty clears it. Renaming the last account of a brand carries its voice along. */
export const setBrand = mutation({
  args: { userId: v.id("users"), accountId: v.string(), brand: v.string() },
  handler: async (ctx, { userId, accountId, brand }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("accounts", accountId);
    const account = id ? await ctx.db.get(id) : null;
    if (!(await canAccessAccount(ctx, userId, account)) || !account) return;
    const previous = account.brand;
    const name = brand.trim().replace(/\s+/g, " ").slice(0, 40) || undefined;
    await ctx.db.patch(account._id, { brand: name });
    if (previous && name && previous !== name) {
      const others = await ctx.db
        .query("accounts")
        .withIndex("by_user", (q) => q.eq("userId", account.userId))
        .collect();
      if (!others.some((other) => other._id !== account._id && other.brand === previous)) {
        const oldVoice = await ctx.db
          .query("socialBrands")
          .withIndex("by_user_name", (q) => q.eq("userId", account.userId).eq("name", previous))
          .unique();
        const nextVoice = await ctx.db
          .query("socialBrands")
          .withIndex("by_user_name", (q) => q.eq("userId", account.userId).eq("name", name))
          .unique();
        if (oldVoice && !nextVoice) await ctx.db.patch(oldVoice._id, { name });
      }
    }
  },
});

/** One account, credentials and all, for the app server's sends. */
export const get = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<Doc<"accounts"> | null> => {
    await requireServer(ctx);
    return await ctx.db.get(accountId);
  },
});

/** Marks an X account as Premium (long posts), or not. */
export const setLongPosts = mutation({
  args: { userId: v.id("users"), accountId: v.string(), longPosts: v.boolean() },
  handler: async (ctx, { userId, accountId, longPosts }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("accounts", accountId);
    const account = id ? await ctx.db.get(id) : null;
    if (!(await canAccessAccount(ctx, userId, account)) || !account || account.provider !== "x") return;
    await ctx.db.patch(account._id, { longPosts: longPosts || undefined });
  },
});

/** Says posting as an account stopped working, until it's reconnected. */
export const markBroken = mutation({
  args: { accountId: v.id("accounts"), reason: v.string() },
  handler: async (ctx, { accountId, reason }) => {
    await requireServer(ctx);
    const account = await ctx.db.get(accountId);
    if (account) await ctx.db.patch(account._id, { broken: reason.slice(0, 300) });
  },
});
