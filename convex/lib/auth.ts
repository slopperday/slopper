import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Two kinds of caller, both proven by JWTs that only the Slopper app server
 * can sign (see `auth.config.ts`):
 *
 * - `sub: "server"`: the app server itself. Required for anything with
 *   business rules the server computes (dates, validation, OAuth).
 * - `sub: <users id>`: a signed-in person, used by the browser for live
 *   queries that depend on who is looking.
 */

export const SERVER_SUBJECT = "server";

export async function isServer(ctx: QueryCtx): Promise<boolean> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject === SERVER_SUBJECT;
}

export async function requireServer(ctx: QueryCtx): Promise<void> {
  if (!(await isServer(ctx))) throw new ConvexError("Only the Slopper server can do that.");
}

/** The signed-in person, or null for visitors and for the server itself. */
export async function viewer(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || identity.subject === SERVER_SUBJECT) return null;
  const id = ctx.db.normalizeId("users", identity.subject);
  return id ? await ctx.db.get(id) : null;
}

export async function requireViewer(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await viewer(ctx);
  if (!user) throw new ConvexError("Sign in first.");
  return user;
}

/**
 * Who a read is for. The server may read on behalf of a person by passing
 * their id; everyone else reads as themselves.
 */
export async function readerFor(ctx: QueryCtx, asUser: Id<"users"> | null | undefined): Promise<Doc<"users"> | null> {
  if (asUser && (await isServer(ctx))) return await ctx.db.get(asUser);
  return await viewer(ctx);
}
