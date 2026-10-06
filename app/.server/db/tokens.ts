import type { Kv } from "@deno/kv";
import type { User } from "~/lib/model";
import { encodeBase64Url, randomToken } from "../encoding";
import { listValues, newId } from "../kv";
import { getUser } from "./users";

/**
 * Personal API tokens for agents (REST and MCP). Only a SHA-256 hash is
 * stored; the token itself is shown once, at creation.
 */

export interface ApiToken {
  id: string;
  userId: string;
  name: string;
  /** First characters, so people can tell tokens apart. */
  preview: string;
  hash: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export type PublicApiToken = Omit<ApiToken, "hash">;

const PREFIX = "slp_";
const MAX_TOKENS = 10;

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return encodeBase64Url(new Uint8Array(digest));
}

export async function createApiToken(
  kv: Kv,
  userId: string,
  name: string,
): Promise<{ ok: true; token: string; record: PublicApiToken } | { ok: false; error: string }> {
  const existing = await listApiTokens(kv, userId);
  if (existing.length >= MAX_TOKENS) return { ok: false, error: `Up to ${MAX_TOKENS} tokens. Revoke one first.` };
  const token = `${PREFIX}${randomToken(32)}`;
  const record: ApiToken = {
    id: newId(),
    userId,
    name: name.trim().slice(0, 60) || "Agent",
    preview: token.slice(0, 10),
    hash: await hashToken(token),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  await kv
    .atomic()
    .set(["api_token", record.hash], record)
    .set(["api_tokens_by_user", userId, record.id], record.hash)
    .commit();
  const { hash: _hash, ...visible } = record;
  return { ok: true, token, record: visible };
}

export async function listApiTokens(kv: Kv, userId: string): Promise<PublicApiToken[]> {
  const hashes = await listValues<string>(kv, { prefix: ["api_tokens_by_user", userId] });
  const tokens: PublicApiToken[] = [];
  for (const hash of hashes) {
    const record = (await kv.get<ApiToken>(["api_token", hash])).value;
    if (record) {
      const { hash: _hash, ...visible } = record;
      tokens.push(visible);
    }
  }
  return tokens;
}

export async function revokeApiToken(kv: Kv, userId: string, tokenId: string): Promise<void> {
  const pointer = await kv.get<string>(["api_tokens_by_user", userId, tokenId]);
  if (!pointer.value) return;
  await kv.atomic().delete(pointer.key).delete(["api_token", pointer.value]).commit();
}

/** Resolves `Authorization: Bearer slp_…` to its user. */
export async function userForBearer(kv: Kv, request: Request): Promise<User | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(slp_[A-Za-z0-9_-]+)$/i.exec(header.trim());
  if (!match) return null;
  const entry = await kv.get<ApiToken>(["api_token", await hashToken(match[1])]);
  if (!entry.value) return null;
  const user = await getUser(kv, entry.value.userId);
  if (!user) return null;
  // Touch at most hourly so busy agents don't turn every call into a write.
  const last = entry.value.lastUsedAt ? Date.parse(entry.value.lastUsedAt) : 0;
  if (Date.now() - last > 3_600_000) {
    await kv.set(entry.key, { ...entry.value, lastUsedAt: new Date().toISOString() });
  }
  return user;
}
