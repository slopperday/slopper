import type { Kv } from "@deno/kv";
import type { ConnectedAccount, CrosspostMode, SocialProvider } from "~/lib/model";
import { listValues, newId, withRetry } from "../kv";

export interface AccountProfile {
  provider: SocialProvider;
  remoteId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  sealedCredentials: string;
  expiresAt: string | null;
}

/**
 * Connects a social account, or refreshes the credentials when the same
 * remote account is connected again (e.g. LinkedIn's 60 day reconnect).
 */
export async function connectAccount(kv: Kv, userId: string, profile: AccountProfile): Promise<ConnectedAccount> {
  const remoteKey = ["account_by_remote", userId, profile.provider, profile.remoteId];
  return await withRetry(async () => {
    const pointer = await kv.get<string>(remoteKey);
    const existing = pointer.value ? await kv.get<ConnectedAccount>(["account", userId, pointer.value]) : null;

    const account: ConnectedAccount = existing?.value
      ? { ...existing.value, ...profile }
      : {
          id: newId(),
          userId,
          ...profile,
          // A person's first account on a network posts; extra ones amplify.
          defaultMode: (await hasProvider(kv, userId, profile.provider)) ? "amplify" : "post",
          createdAt: new Date().toISOString(),
        };

    const op = kv.atomic().check(pointer).set(["account", userId, account.id], account).set(remoteKey, account.id);
    if (existing) op.check(existing);
    return (await op.commit()).ok ? account : null;
  });
}

async function hasProvider(kv: Kv, userId: string, provider: SocialProvider): Promise<boolean> {
  const accounts = await listAccounts(kv, userId);
  return accounts.some((account) => account.provider === provider);
}

export function listAccounts(kv: Kv, userId: string): Promise<ConnectedAccount[]> {
  return listValues<ConnectedAccount>(kv, { prefix: ["account", userId] });
}

export async function getAccount(kv: Kv, userId: string, accountId: string): Promise<ConnectedAccount | null> {
  return (await kv.get<ConnectedAccount>(["account", userId, accountId])).value;
}

/** Persists rotated credentials (X rotates its refresh token on every use). */
export async function storeCredentials(
  kv: Kv,
  account: ConnectedAccount,
  sealedCredentials: string,
  expiresAt: string | null,
): Promise<ConnectedAccount> {
  const next = { ...account, sealedCredentials, expiresAt };
  await kv.set(["account", account.userId, account.id], next);
  return next;
}

export async function setDefaultMode(kv: Kv, userId: string, accountId: string, mode: CrosspostMode): Promise<void> {
  await withRetry(async () => {
    const entry = await kv.get<ConnectedAccount>(["account", userId, accountId]);
    if (!entry.value) return true;
    const result = await kv
      .atomic()
      .check(entry)
      .set(entry.key, { ...entry.value, defaultMode: mode })
      .commit();
    return result.ok ? true : null;
  });
}

export async function disconnectAccount(kv: Kv, userId: string, accountId: string): Promise<void> {
  const account = await getAccount(kv, userId, accountId);
  if (!account) return;
  await kv
    .atomic()
    .delete(["account", userId, accountId])
    .delete(["account_by_remote", userId, account.provider, account.remoteId])
    .commit();
}
