import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import { convex } from "./convex";
import { hashToken, randomToken } from "./encoding";
import { newApiToken } from "./tokens";

/**
 * `slopper login` without a token (see convex/cliLogins.ts). The CLI keeps
 * the device code secret and polls with it; the person approves the user
 * code in the browser, so it only has to be easy to compare by eye.
 */

/** Consonants that can't be misread for each other or spell words. */
const USER_CODE_LETTERS = "BCDFGHJKLMNPQRSTVWXZ";
const USER_CODE_LENGTH = 8;
const USER_CODE = new RegExp(`^[${USER_CODE_LETTERS}]{${USER_CODE_LENGTH}}$`);
/** How often the CLI asks whether the login was approved, in seconds. */
export const POLL_INTERVAL_S = 2;

function newUserCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(USER_CODE_LENGTH));
  // 256 isn't a multiple of 20, so drop the bias by retrying the few bytes that fall past it.
  const letters = [...bytes].map((byte) => {
    let value = byte;
    while (value >= 240) value = crypto.getRandomValues(new Uint8Array(1))[0];
    return USER_CODE_LETTERS[value % USER_CODE_LETTERS.length];
  });
  return `${letters.slice(0, 4).join("")}-${letters.slice(4).join("")}`;
}

/** A user code as people type or paste it (any case, spaces, no dash), or null when it can't be one. */
export function normalizeUserCode(input: string): string | null {
  const letters = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (!USER_CODE.test(letters)) return null;
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

export interface StartedLogin {
  deviceCode: string;
  userCode: string;
  expiresAt: number;
}

export async function startCliLogin(name: string): Promise<StartedLogin> {
  const deviceCode = randomToken(32);
  const deviceCodeHash = await hashToken(deviceCode);
  // A clash between two live user codes is about one in ten billion; one retry covers it.
  for (let attempt = 0; ; attempt++) {
    const userCode = newUserCode();
    try {
      const { expiresAt } = await convex.mutation(api.cliLogins.start, { deviceCodeHash, userCode, name });
      return { deviceCode, userCode, expiresAt };
    } catch (error) {
      if (!(error instanceof ConvexError) || attempt > 0) throw error;
    }
  }
}

export type CollectResult =
  | { status: "pending" | "denied" | "expired" }
  | { status: "approved"; token: string; username: string };

/** The CLI's poll: the new API token once the login is approved, shown this one time. */
export async function collectCliLogin(deviceCode: string): Promise<CollectResult> {
  const candidate = await newApiToken();
  const collected = await convex.mutation(api.cliLogins.collect, {
    deviceCodeHash: await hashToken(deviceCode),
    hash: candidate.hash,
    preview: candidate.preview,
  });
  if (collected.status !== "approved") return { status: collected.status };
  return { status: "approved", token: candidate.token, username: collected.username };
}
