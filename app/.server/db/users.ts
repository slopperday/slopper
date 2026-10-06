import type { Kv } from "@deno/kv";
import { randomToken } from "../encoding";
import type { LoginProvider, User } from "~/lib/model";
import { LIMITS } from "~/lib/model";
import { isValidTimeZone } from "~/lib/dates";
import { newId, withRetry } from "../kv";

const SESSION_TTL_MS = 30 * 86_400_000;

/** Paths and words that would make confusing handles. */
const RESERVED_USERNAMES = new Set([
  "admin",
  "api",
  "auth",
  "help",
  "media",
  "menu",
  "moderator",
  "new",
  "root",
  "settings",
  "ship",
  "slopper",
  "support",
]);

export const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,28}[a-z0-9])?$/;

export function normalizeUsername(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 30);
}

export function usernameProblem(username: string): string | null {
  if (!USERNAME_PATTERN.test(username)) {
    return "Use 1–30 letters, numbers, dashes or underscores.";
  }
  if (RESERVED_USERNAMES.has(username)) return "That name is reserved.";
  return null;
}

export async function getUser(kv: Kv, id: string): Promise<User | null> {
  return (await kv.get<User>(["user", id])).value;
}

export async function getUserByUsername(kv: Kv, username: string): Promise<User | null> {
  const id = await kv.get<string>(["user_by_name", username.toLowerCase()]);
  return id.value ? await getUser(kv, id.value) : null;
}

export interface IdentityProfile {
  provider: LoginProvider;
  providerId: string;
  preferredUsername: string;
  displayName: string;
  avatarUrl: string | null;
  website?: string | null;
  bio?: string;
}

/**
 * Returns the user for a login identity, creating one on first sign in. The
 * username is the provider's handle when free, otherwise suffixed.
 */
export async function upsertUserFromIdentity(
  kv: Kv,
  profile: IdentityProfile,
  timeZone: string,
): Promise<{ user: User; created: boolean }> {
  const identityKey = ["identity", profile.provider, profile.providerId];
  return await withRetry(async () => {
    const identity = await kv.get<string>(identityKey);
    if (identity.value) {
      const existing = await getUser(kv, identity.value);
      if (existing) return { user: existing, created: false };
    }

    const base = normalizeUsername(profile.preferredUsername) || "slopper";
    const username = await findFreeUsername(kv, base);
    const user: User = {
      id: newId(),
      username,
      displayName: profile.displayName.slice(0, 60) || username,
      avatarUrl: profile.avatarUrl,
      bio: (profile.bio ?? "").slice(0, LIMITS.bioLength),
      website: profile.website ?? null,
      timeZone: isValidTimeZone(timeZone) ? timeZone : "UTC",
      showNsfw: false,
      createdAt: new Date().toISOString(),
    };
    const result = await kv
      .atomic()
      .check(identity)
      .check({ key: ["user_by_name", username], versionstamp: null })
      .set(["user", user.id], user)
      .set(["user_by_name", username], user.id)
      .set(identityKey, user.id)
      .commit();
    return result.ok ? { user, created: true } : null;
  });
}

async function findFreeUsername(kv: Kv, base: string): Promise<string> {
  const candidates = [base];
  for (let i = 2; i < 50; i++) candidates.push(`${base.slice(0, 26)}-${i}`);
  for (const candidate of candidates) {
    if (usernameProblem(candidate)) continue;
    const taken = await kv.get(["user_by_name", candidate]);
    if (!taken.value) return candidate;
  }
  return `slopper-${newId().slice(-8).toLowerCase()}`;
}

export interface ProfileChanges {
  username: string;
  displayName: string;
  bio: string;
  website: string | null;
  timeZone: string;
  showNsfw: boolean;
}

export type ProfileUpdateResult = { ok: true; user: User } | { ok: false; error: string };

export async function updateProfile(kv: Kv, userId: string, changes: ProfileChanges): Promise<ProfileUpdateResult> {
  const problem = usernameProblem(changes.username);
  if (problem) return { ok: false, error: problem };
  if (!isValidTimeZone(changes.timeZone)) {
    return { ok: false, error: "Unknown time zone." };
  }

  return await withRetry(async () => {
    const current = await kv.get<User>(["user", userId]);
    if (!current.value) return { ok: false, error: "Account not found." };
    const user: User = {
      ...current.value,
      ...changes,
      displayName: changes.displayName.slice(0, 60) || changes.username,
      bio: changes.bio.slice(0, LIMITS.bioLength),
    };
    const op = kv.atomic().check(current).set(["user", userId], user);
    if (user.username !== current.value.username) {
      const nameKey = ["user_by_name", user.username];
      const taken = await kv.get<string>(nameKey);
      if (taken.value && taken.value !== userId) {
        return { ok: false, error: "That username is taken." };
      }
      op.check(taken).set(nameKey, userId).delete(["user_by_name", current.value.username]);
    }
    const result = await op.commit();
    return result.ok ? { ok: true, user } : null;
  });
}

export async function createSession(kv: Kv, userId: string): Promise<{ token: string; maxAgeSeconds: number }> {
  const token = randomToken();
  await kv.set(
    ["session", token],
    {
      userId,
      createdAt: new Date().toISOString(),
    },
    { expireIn: SESSION_TTL_MS },
  );
  return { token, maxAgeSeconds: SESSION_TTL_MS / 1000 };
}

export async function getSessionUser(kv: Kv, token: string): Promise<User | null> {
  const session = await kv.get<{ userId: string }>(["session", token]);
  return session.value ? await getUser(kv, session.value.userId) : null;
}

export async function deleteSession(kv: Kv, token: string) {
  await kv.delete(["session", token]);
}
