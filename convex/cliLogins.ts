import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { insertToken, tokenName } from "./tokens";

/**
 * `slopper login` without a token, a device sign-in like the one TVs use:
 *
 * 1. `start`: the app server stores a hash of the CLI's secret device code
 *    and a short user code, both new.
 * 2. `lookup` and `decide`: the person opens /cli?code=… while signed in,
 *    checks it matches what the terminal shows, and approves or denies it.
 * 3. `collect`: the CLI polls with its device code. Once it's approved, the
 *    API token the app server just made is stored here (replacing the one
 *    that machine had before, so logging in again doesn't pile them up) and
 *    the login is spent.
 */

/** Long enough to find the browser tab, short enough that a stray link goes stale. */
export const LOGIN_TTL_MS = 10 * 60_000;

export const start = mutation({
  args: { deviceCodeHash: v.string(), userCode: v.string(), name: v.string() },
  handler: async (ctx, { deviceCodeHash, userCode, name }): Promise<{ expiresAt: number }> => {
    await requireServer(ctx);
    const now = Date.now();
    const stale = await ctx.db
      .query("cliLogins")
      .withIndex("by_expiry", (q) => q.lt("expiresAt", now))
      .take(20);
    for (const login of stale) await ctx.db.delete(login._id);

    const clash = await ctx.db
      .query("cliLogins")
      .withIndex("by_user_code", (q) => q.eq("userCode", userCode))
      .first();
    if (clash) throw new ConvexError("That user code is taken.");
    const expiresAt = now + LOGIN_TTL_MS;
    await ctx.db.insert("cliLogins", {
      deviceCodeHash,
      userCode,
      name: tokenName(name),
      expiresAt,
      status: "pending",
      userId: null,
    });
    return { expiresAt };
  },
});

/** What /cli shows for a user code, or null when there's no such login. */
export const lookup = query({
  args: { userCode: v.string() },
  handler: async (ctx, { userCode }) => {
    await requireServer(ctx);
    const login = await ctx.db
      .query("cliLogins")
      .withIndex("by_user_code", (q) => q.eq("userCode", userCode))
      .first();
    return login ? { name: login.name, status: login.status, expiresAt: login.expiresAt } : null;
  },
});

/** Approves or denies a pending login for the signed-in person. Anything else is left as it is. */
export const decide = mutation({
  args: { userId: v.id("users"), userCode: v.string(), approve: v.boolean() },
  handler: async (ctx, { userId, userCode, approve }) => {
    await requireServer(ctx);
    const login = await ctx.db
      .query("cliLogins")
      .withIndex("by_user_code", (q) => q.eq("userCode", userCode))
      .first();
    if (!login || login.status !== "pending" || login.expiresAt < Date.now()) return { decided: false };
    await ctx.db.patch(login._id, approve ? { status: "approved", userId } : { status: "denied" });
    return { decided: true };
  },
});

export type Collected =
  | { status: "pending" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "approved"; username: string };

/**
 * The CLI's poll. Once the login is approved this stores the token the app
 * server made (`hash`, `preview`) for that person and spends the login, so
 * only one poll ever gets a token.
 */
export const collect = mutation({
  args: { deviceCodeHash: v.string(), hash: v.string(), preview: v.string() },
  handler: async (ctx, { deviceCodeHash, hash, preview }): Promise<Collected> => {
    await requireServer(ctx);
    const login = await ctx.db
      .query("cliLogins")
      .withIndex("by_device_code", (q) => q.eq("deviceCodeHash", deviceCodeHash))
      .unique();
    if (!login || login.status === "used" || login.expiresAt < Date.now()) return { status: "expired" };
    if (login.status === "pending") return { status: "pending" };
    if (login.status === "denied") return { status: "denied" };

    const user = login.userId ? await ctx.db.get(login.userId) : null;
    if (!user) return { status: "expired" };
    // Logging in again from the same machine replaces its token.
    const tokens = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const token of tokens) if (token.name === login.name) await ctx.db.delete(token._id);
    await insertToken(ctx, { userId: user._id, name: login.name, preview, hash });
    await ctx.db.patch(login._id, { status: "used" });
    return { status: "approved", username: user.username };
  },
});
