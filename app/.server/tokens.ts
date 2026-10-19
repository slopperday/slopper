import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LIMITS } from "~/lib/model";
import { absoluteUrl } from "./config";
import { convex } from "./convex";
import { hashToken, randomToken } from "./encoding";
import type { User } from "./session";

/**
 * Personal API tokens for agents (REST and MCP). Convex stores only a hash;
 * the token itself is shown once, at creation.
 */

const PREFIX = "slp_";

/** A new token, with what Convex keeps of it: its hash and the first few characters to recognise it by. */
export async function newApiToken(): Promise<{ token: string; preview: string; hash: string }> {
  const token = `${PREFIX}${randomToken(32)}`;
  return { token, preview: token.slice(0, 10), hash: await hashToken(token) };
}

export async function createApiToken(userId: Id<"users">, name: string): Promise<string> {
  const { token, preview, hash } = await newApiToken();
  await convex.mutation(api.tokens.create, { userId, name, preview, hash });
  return token;
}

/** Resolves `Authorization: Bearer slp_…` to its user. */
export async function userForBearer(request: Request): Promise<User | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(slp_[A-Za-z0-9_-]+)$/i.exec(header.trim());
  if (!match) return null;
  return await convex.mutation(api.tokens.use, { hash: await hashToken(match[1]) });
}

/** False once `key` has used up `limit` calls in the window. */
export async function allowAction(key: string, limit: number, windowMs: number): Promise<boolean> {
  return await convex.mutation(api.limits.hit, { key, limit, windowMs });
}

/** Who sent a request. Netlify names the caller; anywhere else (a local server) they share one bucket. */
export function callerAddress(request: Request): string {
  return request.headers.get("x-nf-client-connection-ip") ?? "local";
}

const HOUR_MS = 3_600_000;

/**
 * Counts one REST or MCP call. A token gets LIMITS.apiCallsPerHour; without
 * one, each address shares the smaller LIMITS.anonymousApiCallsPerHour.
 * Once the hour's calls are used up, says so and when to try again.
 */
export async function apiQuota(
  surface: "api" | "mcp",
  user: User | null,
  request: Request,
): Promise<{ error: string; retryAfter: number } | null> {
  const limit = user ? LIMITS.apiCallsPerHour : LIMITS.anonymousApiCallsPerHour;
  const key = user ? `${surface}:${user._id}` : `${surface}:ip:${callerAddress(request)}`;
  if (await allowAction(key, limit, HOUR_MS)) return null;
  // Windows are whole clock hours (convex/lib/rate.ts), so the next one starts on the hour.
  const retryAfter = Math.ceil((HOUR_MS - (Date.now() % HOUR_MS)) / 1000);
  const more = user
    ? ""
    : ` Sign in (slopper login, or a token from ${absoluteUrl("/settings/api")}) for ${LIMITS.apiCallsPerHour}.`;
  const minutes = Math.ceil(retryAfter / 60);
  return {
    error: `Rate limit reached: ${limit} calls an hour.${more} Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    retryAfter,
  };
}
