import type { Kv } from "@deno/kv";
import { LIMITS, type Pledge, type Slop } from "~/lib/model";
import { withRetry } from "../kv";

/**
 * "Take my money" pledges. Non-binding for now: they measure demand before
 * any payment rails exist. One pledge per person per launch; pledging again
 * replaces the amount, and a zero amount withdraws it.
 */

export type PledgeResult =
  | { ok: true; backers: number; pledged: number; amount: number }
  | { ok: false; reason: "not-found" | "own-slop" | "invalid-amount" };

export async function setPledge(kv: Kv, slopId: string, userId: string, amount: number): Promise<PledgeResult> {
  if (!Number.isInteger(amount) || amount < 0 || amount > LIMITS.maxPledge) {
    return { ok: false, reason: "invalid-amount" };
  }
  return await withRetry<PledgeResult>(async () => {
    const [slopEntry, pledgeEntry] = await kv.getMany<[Slop, Pledge]>([
      ["slop", slopId],
      ["pledge", slopId, userId],
    ]);
    const slop = slopEntry.value;
    if (!slop || slop.hidden) return { ok: false, reason: "not-found" };
    if (slop.userId === userId) return { ok: false, reason: "own-slop" };
    const previous = pledgeEntry.value?.amount ?? 0;
    const next: Slop = {
      ...slop,
      backers: slop.backers + (amount > 0 ? 1 : 0) - (previous > 0 ? 1 : 0),
      pledged: slop.pledged + amount - previous,
    };
    const op = kv.atomic().check(slopEntry).check(pledgeEntry).set(slopEntry.key, next);
    if (amount === 0) op.delete(["pledge", slopId, userId]);
    else op.set(["pledge", slopId, userId], { slopId, userId, amount, createdAt: new Date().toISOString() });
    const result = await op.commit();
    return result.ok ? { ok: true, backers: next.backers, pledged: next.pledged, amount } : null;
  });
}

export async function getPledge(kv: Kv, slopId: string, userId: string): Promise<number> {
  return (await kv.get<Pledge>(["pledge", slopId, userId])).value?.amount ?? 0;
}
