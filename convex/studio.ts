import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { consume } from "./lib/rate";
import { canAccessAccount, userOrganizationIds } from "./organizations";
import { DEFAULT_SLOTS, wakeDuePosts } from "./social";

/**
 * The studio's supporting records: the posting queue and pause switch, the
 * calendar feed and webhook (`socialSettings`), saved words (`socialSnippets`),
 * brand voices, tracked links, preview links and RSS feeds. Every function is
 * for the app server, which says whose they are.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function token(bytes = 24): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return Array.from(raw, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function settingsRow(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("socialSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** A person's settings as their pages show them. The webhook secret is shown so they can verify signatures. */
export const settings = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    const row = await settingsRow(ctx, userId);
    return {
      paused: row?.paused ?? false,
      slots: row?.slots ?? DEFAULT_SLOTS,
      calendarToken: row?.calendarToken ?? null,
      lastAccountIds: row?.lastAccountIds ?? [],
      workflows: row?.workflows ?? [],
      defaultWorkflowId: row?.defaultWorkflowId ?? null,
      webhook: row?.webhook ?? null,
    };
  },
});

export const saveSettings = mutation({
  args: {
    userId: v.id("users"),
    slots: v.optional(v.array(v.object({ day: v.number(), minute: v.number() }))),
    paused: v.optional(v.boolean()),
    calendar: v.optional(v.union(v.literal("create"), v.literal("revoke"))),
    webhookUrl: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { userId, slots, paused, calendar, webhookUrl }) => {
    await requireServer(ctx);
    const row = await settingsRow(ctx, userId);
    const patch: Partial<Doc<"socialSettings">> = {};
    if (slots) {
      patch.slots = slots
        .filter(
          (slot) =>
            Number.isInteger(slot.day) && slot.day >= 0 && slot.day <= 6 && slot.minute >= 0 && slot.minute < 1440,
        )
        .map((slot) => ({ day: slot.day, minute: Math.round(slot.minute) }))
        .slice(0, 70);
    }
    if (paused !== undefined) patch.paused = paused;
    if (calendar === "create") patch.calendarToken = token();
    if (calendar === "revoke") patch.calendarToken = undefined;
    if (webhookUrl !== undefined) {
      patch.webhook = webhookUrl ? { url: webhookUrl, secret: row?.webhook?.secret ?? token(32) } : undefined;
    }
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert("socialSettings", { userId, slots: DEFAULT_SLOTS, ...patch });
    // Resuming sends what came due while paused.
    if (paused === false && row?.paused) await wakeDuePosts(ctx, userId);
  },
});

const WORKFLOWS = 20;

/** Saves a workflow (a new one without `id`), and makes it the one new posts start with when `makeDefault`. */
export const saveWorkflow = mutation({
  args: {
    userId: v.id("users"),
    id: v.optional(v.string()),
    name: v.string(),
    accountIds: v.array(v.string()),
    when: v.union(v.literal("now"), v.literal("queue")),
    productId: v.union(v.string(), v.null()),
    trackLinks: v.boolean(),
    makeDefault: v.boolean(),
  },
  handler: async (ctx, { userId, id, name, accountIds, when, productId, trackLinks, makeDefault }) => {
    await requireServer(ctx);
    const title = name.trim().slice(0, 60);
    if (!title) throw new ConvexError("Give the workflow a name.");
    const accounts: Id<"accounts">[] = [];
    for (const raw of accountIds.slice(0, 50)) {
      const accountId = ctx.db.normalizeId("accounts", raw);
      const account = accountId ? await ctx.db.get(accountId) : null;
      if (account && (await canAccessAccount(ctx, userId, account)) && !accounts.includes(account._id)) {
        accounts.push(account._id);
      }
    }
    if (accounts.length === 0) throw new ConvexError("Pick the accounts it posts as.");
    const row = await settingsRow(ctx, userId);
    const list = row?.workflows ?? [];
    const existing = id ? list.find((workflow) => workflow.id === id) : undefined;
    if (!existing && list.length >= WORKFLOWS) throw new ConvexError(`${WORKFLOWS} workflows at most.`);
    const workflow = {
      id: existing?.id ?? token(8),
      name: title,
      accountIds: accounts,
      when,
      productId: productId ? productId.slice(0, 64) : null,
      trackLinks,
    };
    const workflows = existing ? list.map((item) => (item.id === existing.id ? workflow : item)) : [...list, workflow];
    const patch = {
      workflows,
      ...(makeDefault
        ? { defaultWorkflowId: workflow.id }
        : row?.defaultWorkflowId === workflow.id
          ? { defaultWorkflowId: undefined }
          : {}),
    };
    if (row) await ctx.db.patch(row._id, patch);
    else await ctx.db.insert("socialSettings", { userId, slots: DEFAULT_SLOTS, ...patch });
    return workflow.id;
  },
});

/** Deletes a workflow. */
export const removeWorkflow = mutation({
  args: { userId: v.id("users"), id: v.string() },
  handler: async (ctx, { userId, id }) => {
    await requireServer(ctx);
    const row = await settingsRow(ctx, userId);
    if (!row) return;
    await ctx.db.patch(row._id, {
      workflows: (row.workflows ?? []).filter((workflow) => workflow.id !== id),
      ...(row.defaultWorkflowId === id ? { defaultWorkflowId: undefined } : {}),
    });
  },
});

/** Which workflow new posts start with; null goes back to the last post's accounts. */
export const chooseDefaultWorkflow = mutation({
  args: { userId: v.id("users"), id: v.union(v.string(), v.null()) },
  handler: async (ctx, { userId, id }) => {
    await requireServer(ctx);
    const row = await settingsRow(ctx, userId);
    if (!row) return;
    const known = id !== null && (row.workflows ?? []).some((workflow) => workflow.id === id);
    await ctx.db.patch(row._id, { defaultWorkflowId: known ? id! : undefined });
  },
});

export const recordWebhook = mutation({
  args: { userId: v.id("users"), status: v.string() },
  handler: async (ctx, { userId, status }) => {
    await requireServer(ctx);
    const row = await settingsRow(ctx, userId);
    if (row?.webhook)
      await ctx.db.patch(row._id, { webhook: { ...row.webhook, lastStatus: status, lastAt: Date.now() } });
  },
});

/** The scheduled posts behind a calendar feed address, or null when the address is wrong or revoked. */
export const calendarFeed = query({
  args: { token: v.string() },
  handler: async (ctx, { token: raw }) => {
    await requireServer(ctx);
    if (!/^[a-f0-9]{48}$/.test(raw)) return null;
    const row = await ctx.db
      .query("socialSettings")
      .withIndex("by_calendar_token", (q) => q.eq("calendarToken", raw))
      .unique();
    if (!row) return null;
    const posts = await ctx.db
      .query("socialPosts")
      .withIndex("by_user", (q) => q.eq("userId", row.userId))
      .order("desc")
      .take(300);
    const out = [];
    for (const post of posts) {
      if (post.draft || post.cancelled) continue;
      const at = post.scheduledAt ?? post._creationTime;
      if (at < Date.now() - 30 * DAY) continue;
      const deliveries = await ctx.db
        .query("socialDeliveries")
        .withIndex("by_post", (q) => q.eq("postId", post._id))
        .collect();
      out.push({
        id: post._id,
        at,
        text: post.options.youtube?.title || post.text,
        networks: [...new Set(deliveries.map((row) => row.provider))],
      });
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Snippets: hashtag groups, signatures, templates, saved replies.

export const snippets = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    const rows = await ctx.db
      .query("socialSnippets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(200);
    return rows.map((row) => ({
      id: row._id,
      kind: row.kind,
      name: row.name,
      text: row.text,
      autoAdd: row.autoAdd ?? false,
    }));
  },
});

export const saveSnippet = mutation({
  args: {
    userId: v.id("users"),
    id: v.optional(v.string()),
    kind: v.union(v.literal("hashtags"), v.literal("signature"), v.literal("template"), v.literal("reply")),
    name: v.string(),
    text: v.string(),
    autoAdd: v.optional(v.boolean()),
  },
  handler: async (ctx, { userId, id, kind, name, text, autoAdd }) => {
    await requireServer(ctx);
    const clean = {
      kind,
      name: name.trim().slice(0, 60) || "Untitled",
      text: text.trim().slice(0, 5000),
      autoAdd: kind === "signature" && autoAdd ? true : undefined,
    };
    if (!clean.text) throw new ConvexError("Write something to save.");
    // Only one signature adds itself.
    if (clean.autoAdd) {
      const rows = await ctx.db
        .query("socialSnippets")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const row of rows) if (row.autoAdd) await ctx.db.patch(row._id, { autoAdd: undefined });
    }
    const existing = id ? ctx.db.normalizeId("socialSnippets", id) : null;
    const row = existing ? await ctx.db.get(existing) : null;
    if (row && row.userId === userId) {
      await ctx.db.patch(row._id, clean);
      return row._id;
    }
    const count = (
      await ctx.db
        .query("socialSnippets")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(201)
    ).length;
    if (count >= 200) throw new ConvexError("That's 200 snippets already. Delete some first.");
    return await ctx.db.insert("socialSnippets", { userId, ...clean });
  },
});

export const deleteSnippet = mutation({
  args: { userId: v.id("users"), id: v.string() },
  handler: async (ctx, { userId, id }) => {
    await requireServer(ctx);
    const snippetId = ctx.db.normalizeId("socialSnippets", id);
    const row = snippetId ? await ctx.db.get(snippetId) : null;
    if (row && row.userId === userId) await ctx.db.delete(row._id);
  },
});

// ---------------------------------------------------------------------------
// Brand voices, for the writing assistant.

export const brands = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    const rows = await ctx.db
      .query("socialBrands")
      .withIndex("by_user_name", (q) => q.eq("userId", userId))
      .take(100);
    return rows.map((row) => ({ name: row.name, voice: row.voice }));
  },
});

export const saveBrandVoice = mutation({
  args: { userId: v.id("users"), name: v.string(), voice: v.string() },
  handler: async (ctx, { userId, name, voice }) => {
    await requireServer(ctx);
    const brand = name.trim().slice(0, 40);
    if (!brand) return;
    const row = await ctx.db
      .query("socialBrands")
      .withIndex("by_user_name", (q) => q.eq("userId", userId).eq("name", brand))
      .unique();
    const text = voice.trim().slice(0, 1500);
    if (row && !text) await ctx.db.delete(row._id);
    else if (row) await ctx.db.patch(row._id, { voice: text });
    else if (text) await ctx.db.insert("socialBrands", { userId, name: brand, voice: text });
  },
});

// ---------------------------------------------------------------------------
// Tracked links.

/** Follows a short link: where it goes, counting the click when it's a person's. */
export const follow = mutation({
  args: { code: v.string(), count: v.boolean() },
  handler: async (ctx, { code, count }) => {
    await requireServer(ctx);
    if (!/^[A-Za-z0-9]{8}$/.test(code)) return null;
    const row = await ctx.db
      .query("socialLinks")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!row) return null;
    if (count) await ctx.db.patch(row._id, { clicks: row.clicks + 1 });
    return row.url;
  },
});

// ---------------------------------------------------------------------------
// Preview links: anyone with the address sees the post and can say what they think.

const REVIEW_DAYS = 14;

export const createReview = mutation({
  args: { userId: v.id("users"), postId: v.string() },
  handler: async (ctx, { userId, postId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("socialPosts", postId);
    const post = id ? await ctx.db.get(id) : null;
    if (!post) throw new ConvexError("That post is gone.");
    if (post.userId !== userId) {
      const orgIds = await userOrganizationIds(ctx, userId);
      if (!post.organizationId || !orgIds.has(post.organizationId)) {
        throw new ConvexError("That post is gone.");
      }
    }
    // One live link per post: a new one replaces the old.
    const old = await ctx.db
      .query("socialReviews")
      .withIndex("by_post", (q) => q.eq("postId", post._id))
      .collect();
    for (const row of old) if (!row.revoked) await ctx.db.patch(row._id, { revoked: true });
    const value = token();
    await ctx.db.insert("socialReviews", {
      postId: post._id,
      userId,
      token: value,
      expiresAt: Date.now() + REVIEW_DAYS * DAY,
      feedback: old.flatMap((row) => row.feedback).slice(-50),
    });
    return value;
  },
});

export const revokeReview = mutation({
  args: { userId: v.id("users"), postId: v.string() },
  handler: async (ctx, { userId, postId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("socialPosts", postId);
    if (!id) return;
    const rows = await ctx.db
      .query("socialReviews")
      .withIndex("by_post", (q) => q.eq("postId", id))
      .collect();
    for (const row of rows) if (row.userId === userId && !row.revoked) await ctx.db.patch(row._id, { revoked: true });
  },
});

/** The owner's view of a post's preview link and what people said there. */
export const reviewFor = query({
  args: { userId: v.id("users"), postId: v.string() },
  handler: async (ctx, { userId, postId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("socialPosts", postId);
    if (!id) return null;
    const rows = await ctx.db
      .query("socialReviews")
      .withIndex("by_post", (q) => q.eq("postId", id))
      .collect();
    const mine = rows.filter((row) => row.userId === userId);
    const live = mine.find((row) => !row.revoked && row.expiresAt > Date.now());
    return {
      token: live?.token ?? null,
      expiresAt: live?.expiresAt ?? null,
      feedback: mine.flatMap((row) => row.feedback).sort((a, b) => a.at - b.at),
    };
  },
});

/** What a preview link shows: the post's words and media, never stats, notes or credentials. */
export const reviewByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token: raw }) => {
    await requireServer(ctx);
    if (!/^[a-f0-9]{48}$/.test(raw)) return null;
    const row = await ctx.db
      .query("socialReviews")
      .withIndex("by_token", (q) => q.eq("token", raw))
      .unique();
    if (!row || row.revoked || row.expiresAt < Date.now()) return null;
    const post = await ctx.db.get(row.postId);
    if (!post) return null;
    return { postId: post._id, userId: row.userId, expiresAt: row.expiresAt, feedback: row.feedback };
  },
});

export const addFeedback = mutation({
  args: {
    token: v.string(),
    name: v.string(),
    verdict: v.union(v.literal("approve"), v.literal("changes")),
    note: v.string(),
  },
  handler: async (ctx, { token: raw, name, verdict, note }) => {
    await requireServer(ctx);
    const row = await ctx.db
      .query("socialReviews")
      .withIndex("by_token", (q) => q.eq("token", raw))
      .unique();
    if (!row || row.revoked || row.expiresAt < Date.now()) throw new ConvexError("This preview link has expired.");
    await consume(ctx, `review:${row._id}`, 30, DAY);
    const entry = {
      at: Date.now(),
      name: name.trim().slice(0, 60) || "Someone",
      verdict,
      note: note.trim().slice(0, 1000),
    };
    await ctx.db.patch(row._id, { feedback: [...row.feedback, entry].slice(-50) });
    const post = await ctx.db.get(row.postId);
    if (post) {
      const activity = [
        ...(post.activity ?? []),
        {
          at: entry.at,
          kind: verdict === "approve" ? "approved" : "changes",
          detail: `${entry.name} on the preview link${entry.note ? `: ${entry.note}` : ""}`,
        },
      ].slice(-50);
      await ctx.db.patch(post._id, { activity });
    }
  },
});

// ---------------------------------------------------------------------------
// RSS feeds.

export const feeds = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    const rows = await ctx.db
      .query("socialFeeds")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(20);
    return rows.map((row) => ({
      id: row._id,
      url: row.url,
      accountIds: row.accountIds,
      template: row.template,
      mode: row.mode,
      active: row.active,
      checkedAt: row.checkedAt ?? null,
      error: row.error ?? null,
    }));
  },
});

export const addFeed = mutation({
  args: {
    userId: v.id("users"),
    url: v.string(),
    accountIds: v.array(v.string()),
    template: v.string(),
    mode: v.union(v.literal("now"), v.literal("queue")),
    /** Items already in the feed: never posted, so adding a feed doesn't flood the accounts. */
    seen: v.array(v.string()),
  },
  handler: async (ctx, { userId, url, accountIds, template, mode, seen }) => {
    await requireServer(ctx);
    const existing = await ctx.db
      .query("socialFeeds")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(11);
    if (existing.length >= 10) throw new ConvexError("Ten feeds at most.");
    const accounts: Id<"accounts">[] = [];
    for (const raw of accountIds) {
      const id = ctx.db.normalizeId("accounts", raw);
      const account = id ? await ctx.db.get(id) : null;
      if (account && (await canAccessAccount(ctx, userId, account))) accounts.push(account._id);
    }
    if (accounts.length === 0) throw new ConvexError("Pick the accounts a feed posts as.");
    await ctx.db.insert("socialFeeds", {
      userId,
      url,
      accountIds: accounts,
      template: template.trim().slice(0, 1000) || "{title} {link}",
      mode,
      active: true,
      seen: seen.slice(0, 100),
      checkedAt: Date.now(),
    });
  },
});

export const setFeed = mutation({
  args: { userId: v.id("users"), id: v.string(), active: v.optional(v.boolean()), remove: v.optional(v.boolean()) },
  handler: async (ctx, { userId, id, active, remove }) => {
    await requireServer(ctx);
    const feedId = ctx.db.normalizeId("socialFeeds", id);
    const row = feedId ? await ctx.db.get(feedId) : null;
    if (!row || row.userId !== userId) return;
    if (remove) await ctx.db.delete(row._id);
    else if (active !== undefined) await ctx.db.patch(row._id, { active, error: undefined });
  },
});

/** Feeds due a look (checked over half an hour ago), leased by moving their check time. */
export const claimFeeds = mutation({
  args: {},
  handler: async (ctx) => {
    await requireServer(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("socialFeeds")
      .withIndex("by_checked", (q) => q.eq("active", true).lt("checkedAt", now - 30 * 60_000))
      .take(10);
    for (const row of rows) await ctx.db.patch(row._id, { checkedAt: now });
    return rows.map((row) => ({
      id: row._id,
      userId: row.userId,
      url: row.url,
      accountIds: row.accountIds,
      template: row.template,
      mode: row.mode,
      seen: row.seen,
    }));
  },
});

export const recordFeed = mutation({
  args: { id: v.id("socialFeeds"), seen: v.array(v.string()), error: v.union(v.string(), v.null()) },
  handler: async (ctx, { id, seen, error }) => {
    await requireServer(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    await ctx.db.patch(row._id, { seen: seen.slice(0, 100), error: error ?? undefined });
  },
});
