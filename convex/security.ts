import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { consume } from "./lib/rate";

/**
 * Two-factor sign-in: authenticator apps (TOTP), passkeys and recovery
 * codes, the second-factor steps in progress, and the security log. The app
 * server does the cryptography (app/.server/auth/twoFactor.ts); Convex keeps
 * the records and makes each code and each step usable once.
 */

const MINUTE = 60_000;
/** Codes a person can try in a quarter of an hour, whatever the step: guessing six digits takes a million tries. */
const ATTEMPTS = 10;
/** Tries on one step before it's thrown away. */
const STEP_ATTEMPTS = 5;
const EVENTS = 50;

async function totpOf(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("totpFactors")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

async function passkeysOf(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("passkeys")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
}

async function recoveryOf(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("recoveryCodes")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** Whether a person must use a second factor: a confirmed authenticator app, or any passkey. */
export async function hasSecondFactor(ctx: QueryCtx, userId: Id<"users">): Promise<boolean> {
  const totp = await totpOf(ctx, userId);
  if (totp?.confirmed) return true;
  return (await passkeysOf(ctx, userId)).length > 0;
}

async function log(ctx: MutationCtx, userId: Id<"users">, kind: string, detail: string) {
  await ctx.db.insert("securityEvents", { userId, kind, detail: detail.slice(0, 300) });
  const events = await ctx.db
    .query("securityEvents")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .take(EVENTS + 10);
  for (const old of events.slice(EVENTS)) await ctx.db.delete(old._id);
}

/** What the security page shows. Never a secret, a hash or a public key. */
export const factors = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    const totp = await totpOf(ctx, userId);
    const passkeys = await passkeysOf(ctx, userId);
    const recovery = await recoveryOf(ctx, userId);
    return {
      enabled: Boolean(totp?.confirmed) || passkeys.length > 0,
      totp: totp?.confirmed ?? false,
      passkeys: passkeys.map((key) => ({
        id: key._id,
        name: key.name,
        createdAt: key._creationTime,
        lastUsedAt: key.lastUsedAt ?? null,
      })),
      recoveryLeft: recovery?.codes.filter((code) => code.usedAt === undefined).length ?? 0,
    };
  },
});

export const required = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    return await hasSecondFactor(ctx, userId);
  },
});

// ---------------------------------------------------------------------------
// Authenticator apps

/** Starts setting up an app: replaces any unconfirmed secret. A confirmed one stays until it's removed. */
export const startTotp = mutation({
  args: { userId: v.id("users"), sealedSecret: v.string() },
  handler: async (ctx, { userId, sealedSecret }) => {
    await requireServer(ctx);
    const existing = await totpOf(ctx, userId);
    if (existing?.confirmed) throw new ConvexError("An authenticator app is already set up. Remove it first.");
    if (existing) await ctx.db.patch(existing._id, { sealedSecret, lastStep: undefined });
    else await ctx.db.insert("totpFactors", { userId, sealedSecret, confirmed: false });
  },
});

/** The sealed secret, for the app server to check a code against. */
export const totpSecret = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    const totp = await totpOf(ctx, userId);
    return totp
      ? { sealedSecret: totp.sealedSecret, confirmed: totp.confirmed, lastStep: totp.lastStep ?? null }
      : null;
  },
});

/**
 * Spends a code's 30-second step. A step at or before the last one used is
 * refused, so a code someone saw over a shoulder can't be used again.
 * Confirms the app when it's the first code.
 */
export const useTotpStep = mutation({
  args: { userId: v.id("users"), step: v.number() },
  handler: async (ctx, { userId, step }) => {
    await requireServer(ctx);
    const totp = await totpOf(ctx, userId);
    if (!totp || (totp.lastStep !== undefined && step <= totp.lastStep)) return false;
    await ctx.db.patch(totp._id, { lastStep: step, confirmed: true });
    if (!totp.confirmed) await log(ctx, userId, "totp-added", "Authenticator app set up");
    return true;
  },
});

export const removeTotp = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    const totp = await totpOf(ctx, userId);
    if (!totp) return;
    await ctx.db.delete(totp._id);
    if (totp.confirmed) await log(ctx, userId, "totp-removed", "Authenticator app removed");
    await dropRecoveryWhenUnprotected(ctx, userId);
  },
});

// ---------------------------------------------------------------------------
// Passkeys

export const passkeysFor = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    return (await passkeysOf(ctx, userId)).map((key) => ({
      credentialId: key.credentialId,
      transports: key.transports,
    }));
  },
});

export const passkeyByCredential = query({
  args: { credentialId: v.string() },
  handler: async (ctx, { credentialId }): Promise<Doc<"passkeys"> | null> => {
    await requireServer(ctx);
    return await ctx.db
      .query("passkeys")
      .withIndex("by_credential", (q) => q.eq("credentialId", credentialId))
      .unique();
  },
});

export const addPasskey = mutation({
  args: {
    userId: v.id("users"),
    credentialId: v.string(),
    publicKey: v.string(),
    counter: v.number(),
    transports: v.array(v.string()),
    name: v.string(),
  },
  handler: async (ctx, { userId, name, ...key }) => {
    await requireServer(ctx);
    const taken = await ctx.db
      .query("passkeys")
      .withIndex("by_credential", (q) => q.eq("credentialId", key.credentialId))
      .unique();
    if (taken) throw new ConvexError("That passkey is already added.");
    if ((await passkeysOf(ctx, userId)).length >= 10) throw new ConvexError("Ten passkeys at most.");
    const label = name.trim().slice(0, 40) || "Passkey";
    await ctx.db.insert("passkeys", { userId, ...key, transports: key.transports.slice(0, 8), name: label });
    await log(ctx, userId, "passkey-added", `Passkey “${label}” added`);
  },
});

/**
 * Records a passkey sign-in. Authenticators that count must count up: a
 * counter that goes backwards means a cloned key, so it's refused.
 */
export const usePasskey = mutation({
  args: { passkeyId: v.id("passkeys"), counter: v.number() },
  handler: async (ctx, { passkeyId, counter }) => {
    await requireServer(ctx);
    const key = await ctx.db.get(passkeyId);
    if (!key) return false;
    if (key.counter > 0 && counter <= key.counter) {
      await log(ctx, key.userId, "passkey-clone", `Passkey “${key.name}” was refused: its counter went backwards`);
      return false;
    }
    await ctx.db.patch(key._id, { counter, lastUsedAt: Date.now() });
    return true;
  },
});

export const removePasskey = mutation({
  args: { userId: v.id("users"), passkeyId: v.string() },
  handler: async (ctx, { userId, passkeyId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("passkeys", passkeyId);
    const key = id ? await ctx.db.get(id) : null;
    if (!key || key.userId !== userId) return;
    await ctx.db.delete(key._id);
    await log(ctx, userId, "passkey-removed", `Passkey “${key.name}” removed`);
    await dropRecoveryWhenUnprotected(ctx, userId);
  },
});

// ---------------------------------------------------------------------------
// Recovery codes

/** Replaces the recovery codes with new ones (hashed by the app server). */
export const setRecoveryCodes = mutation({
  args: { userId: v.id("users"), hashes: v.array(v.string()) },
  handler: async (ctx, { userId, hashes }) => {
    await requireServer(ctx);
    const codes = hashes.slice(0, 16).map((hash) => ({ hash }));
    const existing = await recoveryOf(ctx, userId);
    if (existing) await ctx.db.patch(existing._id, { codes });
    else await ctx.db.insert("recoveryCodes", { userId, codes });
    await log(
      ctx,
      userId,
      "recovery-codes",
      existing ? "New recovery codes made; the old ones stopped working" : "Recovery codes made",
    );
  },
});

/** Spends a recovery code, once. */
export const useRecoveryCode = mutation({
  args: { userId: v.id("users"), hash: v.string() },
  handler: async (ctx, { userId, hash }) => {
    await requireServer(ctx);
    const row = await recoveryOf(ctx, userId);
    const code = row?.codes.find((item) => item.hash === hash && item.usedAt === undefined);
    if (!row || !code) return false;
    await ctx.db.patch(row._id, {
      codes: row.codes.map((item) => (item === code ? { ...item, usedAt: Date.now() } : item)),
    });
    const left = row.codes.filter((item) => item.usedAt === undefined).length - 1;
    await log(ctx, userId, "recovery-used", `A recovery code was used; ${left} left`);
    return true;
  },
});

/** With no second factor left, recovery codes mean nothing: they go too. */
async function dropRecoveryWhenUnprotected(ctx: MutationCtx, userId: Id<"users">) {
  if (await hasSecondFactor(ctx, userId)) return;
  const row = await recoveryOf(ctx, userId);
  if (row) await ctx.db.delete(row._id);
  await log(ctx, userId, "two-factor-off", "Two-step sign-in turned off");
}

// ---------------------------------------------------------------------------
// Steps in progress

const challengeKind = v.union(v.literal("login"), v.literal("stepup"), v.literal("register"));

export const createChallenge = mutation({
  args: { tokenHash: v.string(), kind: challengeKind, userId: v.id("users"), returnTo: v.string(), ttlMs: v.number() },
  handler: async (ctx, { ttlMs, ...args }) => {
    await requireServer(ctx);
    await ctx.db.insert("authChallenges", {
      ...args,
      attempts: 0,
      expiresAt: Date.now() + Math.min(ttlMs, 15 * MINUTE),
    });
  },
});

export const challenge = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    await requireServer(ctx);
    const row = await ctx.db
      .query("authChallenges")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!row || row.expiresAt < Date.now()) return null;
    return { kind: row.kind, userId: row.userId, challenge: row.challenge ?? null, returnTo: row.returnTo };
  },
});

export const setWebAuthnChallenge = mutation({
  args: { tokenHash: v.string(), challenge: v.string() },
  handler: async (ctx, { tokenHash, challenge }) => {
    await requireServer(ctx);
    const row = await ctx.db
      .query("authChallenges")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (row && row.expiresAt > Date.now()) await ctx.db.patch(row._id, { challenge });
  },
});

/**
 * Counts one try at a step, before the code is checked. Too many on the
 * step and it's thrown away; too many for the person, across steps, and
 * they wait. Returns false when this try isn't allowed.
 */
export const attempt = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    await requireServer(ctx);
    const row = await ctx.db
      .query("authChallenges")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!row || row.expiresAt < Date.now()) return { ok: false as const, reason: "expired" as const };
    if (row.attempts >= STEP_ATTEMPTS) {
      await ctx.db.delete(row._id);
      await log(ctx, row.userId, "two-factor-failed", "Too many wrong codes: that sign-in was stopped");
      return { ok: false as const, reason: "expired" as const };
    }
    await ctx.db.patch(row._id, { attempts: row.attempts + 1 });
    try {
      await consume(ctx, `two-factor:${row.userId}`, ATTEMPTS, 15 * MINUTE);
    } catch {
      return { ok: false as const, reason: "slow" as const };
    }
    return { ok: true as const };
  },
});

/** Ends a step: it worked, or the person called it off. */
export const finishChallenge = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    await requireServer(ctx);
    const row = await ctx.db
      .query("authChallenges")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

// ---------------------------------------------------------------------------
// Sessions and the log

/** When this session last proved it was its owner (0 when it never did). */
export const sessionVerifiedAt = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    await requireServer(ctx);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    return session && session.expiresAt > Date.now() ? (session.verifiedAt ?? 0) : null;
  },
});

export const markVerified = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    await requireServer(ctx);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (session) await ctx.db.patch(session._id, { verifiedAt: Date.now() });
  },
});

/** A person's signed-in sessions, newest first, with which one is this browser's. */
export const sessions = query({
  args: { userId: v.id("users"), currentHash: v.string() },
  handler: async (ctx, { userId, currentHash }) => {
    await requireServer(ctx);
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    return rows
      .filter((row) => row.expiresAt > Date.now())
      .map((row) => ({
        id: row._id,
        startedAt: row._creationTime,
        userAgent: row.userAgent ?? null,
        current: row.tokenHash === currentHash,
      }));
  },
});

/** Signs out everywhere else: every session but this browser's. */
export const endOtherSessions = mutation({
  args: { userId: v.id("users"), keepHash: v.string() },
  handler: async (ctx, { userId, keepHash }) => {
    await requireServer(ctx);
    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    let ended = 0;
    for (const row of rows) {
      if (row.tokenHash === keepHash) continue;
      await ctx.db.delete(row._id);
      ended++;
    }
    if (ended)
      await log(ctx, userId, "sessions-ended", `Signed out ${ended} other ${ended === 1 ? "session" : "sessions"}`);
    return ended;
  },
});

export const endSession = mutation({
  args: { userId: v.id("users"), sessionId: v.string() },
  handler: async (ctx, { userId, sessionId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("sessions", sessionId);
    const row = id ? await ctx.db.get(id) : null;
    if (row && row.userId === userId) {
      await ctx.db.delete(row._id);
      await log(ctx, userId, "sessions-ended", "Signed out a session");
    }
  },
});

export const logEvent = mutation({
  args: { userId: v.id("users"), kind: v.string(), detail: v.string() },
  handler: async (ctx, { userId, kind, detail }) => {
    await requireServer(ctx);
    await log(ctx, userId, kind, detail);
  },
});

export const events = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    const rows = await ctx.db
      .query("securityEvents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(EVENTS);
    return rows.map((row) => ({ at: row._creationTime, kind: row.kind, detail: row.detail }));
  },
});
