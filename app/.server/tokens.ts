import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { convex } from "./convex";
import { hashToken, randomToken } from "./encoding";
import type { User } from "./session";

/**
 * Personal API tokens for agents (REST and MCP). Convex stores only a hash;
 * the token itself is shown once, at creation.
 */

const PREFIX = "slp_";

export async function createApiToken(userId: Id<"users">, name: string): Promise<string> {
  const token = `${PREFIX}${randomToken(32)}`;
  await convex.mutation(api.tokens.create, {
    userId,
    name,
    preview: token.slice(0, 10),
    hash: await hashToken(token),
  });
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
