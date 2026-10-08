import type { Doc } from "../_generated/dataModel";
import { nextLocalHour } from "../../app/lib/dates";

/** Digests go out at this hour on each person's own clock. */
export const DIGEST_HOUR = 9;

type DigestFields = Pick<Doc<"users">, "email" | "emailDigest" | "timeZone">;

/** When this person's next digest is due, or undefined when they get none. */
export function nextDigestAt(user: DigestFields, now: number): number | undefined {
  if (!user.email || user.emailDigest === false) return undefined;
  return nextLocalHour(user.timeZone, DIGEST_HOUR, now);
}

/** The fields to set when an account gets its first email address. */
export function firstEmail(email: string, timeZone: string, now: number): Partial<Doc<"users">> {
  return {
    email,
    emailToken: crypto.randomUUID(),
    nextDigestAt: nextLocalHour(timeZone, DIGEST_HOUR, now),
    // Only what happens from here on goes into a digest.
    digestSentAt: now,
  };
}
