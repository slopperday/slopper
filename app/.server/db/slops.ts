import type { Kv, KvKey } from "@deno/kv";
import { decodeTime } from "ulid";
import type { CategoryId, CrosspostMode, Slop, SlopLink, SlopUpdate, User } from "~/lib/model";
import { goalDayFor } from "~/lib/goal";
import { localDate } from "~/lib/dates";
import { getOpenGoal } from "./goals";
import { getManyValues, newId, present, withRetry } from "../kv";

/** Everything a person types when shipping or editing a slop. */
export interface SlopInput {
  name: string;
  tagline: string;
  description: string;
  category: CategoryId;
  nsfw: boolean;
  links: SlopLink[];
  screenshots: string[];
  madeWith: string[];
}

export function slugify(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "slop"
  );
}

export async function getSlop(kv: Kv, id: string): Promise<Slop | null> {
  return (await kv.get<Slop>(["slop", id])).value;
}

export async function getSlopBySlug(kv: Kv, userId: string, slug: string): Promise<Slop | null> {
  const id = await kv.get<string>(["slop_by_slug", userId, slug]);
  return id.value ? await getSlop(kv, id.value) : null;
}

export async function getSlops(kv: Kv, ids: readonly string[]): Promise<Slop[]> {
  const slops = await getManyValues<Slop>(
    kv,
    ids.map((id) => ["slop", id]),
  );
  return slops.filter(present);
}

/**
 * Ships a slop: stores it with its indexes plus the launch update that
 * starts its updates. The launch counts towards the open goal.
 */
/** Set when this launch is another launch of an existing product. */
export interface Relaunch {
  of: Slop;
  /** What's launching: "iOS app", "Android beta", "2.0"… */
  label: string;
}

export async function createSlop(
  kv: Kv,
  user: User,
  input: SlopInput,
  launchNote: string,
  now: Date = new Date(),
  relaunch: Relaunch | null = null,
): Promise<{ slop: Slop; update: SlopUpdate }> {
  const today = localDate(now, user.timeZone);
  const goal = await getOpenGoal(kv, user.id, today);
  const goalDay = goal ? goalDayFor(goal, today) : null;
  const at = now.toISOString();
  const base = slugify(relaunch ? `${input.name} ${relaunch.label}` : input.name);

  return await withRetry(async () => {
    const slug = await freeSlug(kv, user.id, base);
    const counter = await kv.get<number>(["counter", "slops"]);
    const orderNumber = (counter.value ?? 0) + 1;
    const id = newId();
    const slop: Slop = {
      id,
      userId: user.id,
      productId: relaunch ? relaunch.of.productId : id,
      launchLabel: relaunch ? relaunch.label : null,
      slug,
      ...input,
      launchDate: today,
      launchedAt: at,
      goalId: goalDay && goal ? goal.id : null,
      goalDay,
      goalLength: goalDay && goal ? goal.days : null,
      number: orderNumber,
      slopOfTheDay: null,
      slopcessfulAt: null,
      slopcessfulNote: null,
      upvotes: 0,
      downvotes: 0,
      commentCount: 0,
      updateCount: 1,
      fieldTests: 0,
      backers: 0,
      pledged: 0,
      lastActivityAt: at,
      crosspost: {},
      hidden: false,
      updatedAt: at,
    };
    const update: SlopUpdate = {
      id: newId(),
      slopId: slop.id,
      userId: user.id,
      kind: "launch",
      body: launchNote,
      crossposts: [],
      createdAt: at,
    };
    const result = await kv
      .atomic()
      .check({ key: ["slop_by_slug", user.id, slug], versionstamp: null })
      .check(counter)
      .set(["counter", "slops"], orderNumber)
      .set(["slop", slop.id], slop)
      .set(["slop_by_slug", user.id, slug], slop.id)
      .set(["slops_by_user", user.id, slop.id], slop.id)
      .set(["slops_by_time", slop.id], slop.id)
      .set(["slops_by_category", slop.category, slop.id], slop.id)
      .set(["launches_by_product", slop.productId, slop.id], slop.id)
      .set(["update", slop.id, update.id], update)
      .set(["updates_by_time", update.id], slop.id)
      .commit();
    return result.ok ? { slop, update } : null;
  });
}

async function freeSlug(kv: Kv, userId: string, base: string): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const slug = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
    const taken = await kv.get(["slop_by_slug", userId, slug]);
    if (!taken.value) return slug;
  }
  return `${base.slice(0, 30)}-${newId().slice(-6).toLowerCase()}`;
}

/** Edits the owner-controlled fields. The slug stays stable for links. */
export async function editSlop(kv: Kv, slopId: string, input: SlopInput): Promise<Slop> {
  return await withRetry(async () => {
    const entry = await kv.get<Slop>(["slop", slopId]);
    if (!entry.value) throw new Error(`Slop ${slopId} not found`);
    const slop: Slop = {
      ...entry.value,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    const op = kv.atomic().check(entry).set(["slop", slopId], slop);
    if (slop.category !== entry.value.category) {
      op.delete(["slops_by_category", entry.value.category, slopId]).set(
        ["slops_by_category", slop.category, slopId],
        slopId,
      );
    }
    return (await op.commit()).ok ? slop : null;
  });
}

export async function setCrosspostModes(kv: Kv, slopId: string, modes: Record<string, CrosspostMode>): Promise<void> {
  await withRetry(async () => {
    const entry = await kv.get<Slop>(["slop", slopId]);
    if (!entry.value) throw new Error(`Slop ${slopId} not found`);
    const result = await kv
      .atomic()
      .check(entry)
      .set(["slop", slopId], { ...entry.value, crosspost: modes })
      .commit();
    return result.ok ? true : null;
  });
}

export async function setSlopHidden(kv: Kv, slopId: string, hidden: boolean): Promise<void> {
  await withRetry(async () => {
    const entry = await kv.get<Slop>(["slop", slopId]);
    if (!entry.value) return true;
    const result = await kv
      .atomic()
      .check(entry)
      .set(["slop", slopId], { ...entry.value, hidden })
      .commit();
    return result.ok ? true : null;
  });
}

/** Removes a slop with its indexes, log, comments and votes. */
export async function deleteSlop(kv: Kv, slop: Slop): Promise<void> {
  const keys: KvKey[] = [
    ["slop", slop.id],
    ["slop_by_slug", slop.userId, slop.slug],
    ["slops_by_user", slop.userId, slop.id],
    ["slops_by_time", slop.id],
    ["slops_by_category", slop.category, slop.id],
    ["slopcessful", slop.id],
    ["launches_by_product", slop.productId, slop.id],
  ];
  for (const prefix of [
    ["update", slop.id],
    ["comment", slop.id],
    ["vote", slop.id],
    ["pledge", slop.id],
  ]) {
    for await (const entry of kv.list({ prefix })) {
      keys.push(entry.key);
      if (prefix[0] === "update") {
        keys.push(["updates_by_time", String(entry.key[2])]);
      }
    }
  }
  for (let start = 0; start < keys.length; start += 500) {
    const op = kv.atomic();
    for (const key of keys.slice(start, start + 500)) op.delete(key);
    await op.commit();
  }
}

/**
 * Declares a breakout (users, revenue, virality) and logs it as an update so
 * it can be auto-posted. Passing `null` retracts the claim.
 */
export async function setSlopcessful(
  kv: Kv,
  slopId: string,
  note: string | null,
): Promise<{ slop: Slop; update: SlopUpdate | null }> {
  return await withRetry(async () => {
    const entry = await kv.get<Slop>(["slop", slopId]);
    if (!entry.value) throw new Error(`Slop ${slopId} not found`);
    const at = new Date().toISOString();
    if (note === null) {
      const slop: Slop = { ...entry.value, slopcessfulAt: null, slopcessfulNote: null };
      const result = await kv.atomic().check(entry).set(entry.key, slop).delete(["slopcessful", slopId]).commit();
      return result.ok ? { slop, update: null } : null;
    }
    const slop: Slop = {
      ...entry.value,
      slopcessfulAt: entry.value.slopcessfulAt ?? at,
      slopcessfulNote: note,
      updateCount: entry.value.updateCount + 1,
      lastActivityAt: at,
    };
    const update: SlopUpdate = {
      id: newId(),
      slopId,
      userId: slop.userId,
      kind: "slopcessful",
      body: note,
      crossposts: [],
      createdAt: at,
    };
    const result = await kv
      .atomic()
      .check(entry)
      .set(entry.key, slop)
      .set(["slopcessful", slopId], slopId)
      .set(["update", slopId, update.id], update)
      .set(["updates_by_time", update.id], slopId)
      .commit();
    return result.ok ? { slop, update } : null;
  });
}

/** Every slop that broke out, newest claim first. */
export async function listSlopcessful(kv: Kv): Promise<Slop[]> {
  const ids: string[] = [];
  for await (const entry of kv.list<string>({ prefix: ["slopcessful"] })) ids.push(entry.value);
  const slops = (await getSlops(kv, ids)).filter((slop) => !slop.hidden && slop.slopcessfulAt);
  return slops.sort((a, b) => b.slopcessfulAt!.localeCompare(a.slopcessfulAt!));
}

export type Vote = 1 | -1 | 0;

export type VoteResult = { ok: true; upvotes: number; vote: Vote } | { ok: false; reason: "not-found" | "own-slop" };

/**
 * Sets the voter's vote and adjusts the counters in one atomic commit.
 * Owners cannot vote on their own slops.
 */
export async function castVote(kv: Kv, slopId: string, voterId: string, vote: Vote): Promise<VoteResult> {
  return await withRetry<VoteResult>(async () => {
    const [slopEntry, voteEntry] = await kv.getMany<[Slop, 1 | -1]>([
      ["slop", slopId],
      ["vote", slopId, voterId],
    ]);
    const slop = slopEntry.value;
    if (!slop || slop.hidden) return { ok: false, reason: "not-found" };
    if (slop.userId === voterId) return { ok: false, reason: "own-slop" };
    const previous = voteEntry.value ?? 0;
    if (previous === vote) return { ok: true, upvotes: slop.upvotes, vote };

    const next: Slop = {
      ...slop,
      upvotes: slop.upvotes + (vote === 1 ? 1 : 0) - (previous === 1 ? 1 : 0),
      downvotes: slop.downvotes + (vote === -1 ? 1 : 0) - (previous === -1 ? 1 : 0),
    };
    const op = kv.atomic().check(slopEntry).check(voteEntry).set(["slop", slopId], next);
    if (vote === 0) op.delete(["vote", slopId, voterId]);
    else op.set(["vote", slopId, voterId], vote);
    const result = await op.commit();
    return result.ok ? { ok: true, upvotes: next.upvotes, vote } : null;
  });
}

export async function getVote(kv: Kv, slopId: string, voterId: string): Promise<Vote> {
  return (await kv.get<1 | -1>(["vote", slopId, voterId])).value ?? 0;
}

export async function getVotes(kv: Kv, slopIds: readonly string[], voterId: string): Promise<Map<string, Vote>> {
  const votes = await getManyValues<1 | -1>(
    kv,
    slopIds.map((id) => ["vote", id, voterId]),
  );
  return new Map(slopIds.map((id, index) => [id, votes[index] ?? 0]));
}

export interface Page<T> {
  items: T[];
  cursor: string | null;
}

async function listIndexed(kv: Kv, prefix: KvKey, limit: number, cursor: string | undefined): Promise<Page<Slop>> {
  const iterator = kv.list<string>(
    { prefix },
    {
      reverse: true,
      limit,
      cursor,
    },
  );
  const ids: string[] = [];
  for await (const entry of iterator) ids.push(entry.value);
  const slops = (await getSlops(kv, ids)).filter((slop) => !slop.hidden);
  return {
    items: slops,
    cursor: ids.length === limit ? iterator.cursor : null,
  };
}

export function listRecentSlops(
  kv: Kv,
  options: { limit?: number; cursor?: string; category?: CategoryId } = {},
): Promise<Page<Slop>> {
  const prefix = options.category ? ["slops_by_category", options.category] : ["slops_by_time"];
  return listIndexed(kv, prefix, options.limit ?? 24, options.cursor);
}

/** Slops launched since `since`, newest first. */
export async function listSlopsSince(kv: Kv, since: Date, max = 200): Promise<Slop[]> {
  const ids: string[] = [];
  for await (const entry of kv.list<string>(
    { prefix: ["slops_by_time"] },
    {
      reverse: true,
    },
  )) {
    if (decodeTime(entry.value) < since.getTime() || ids.length >= max) break;
    ids.push(entry.value);
  }
  return (await getSlops(kv, ids)).filter((slop) => !slop.hidden);
}

/** Every launch of a product, first launch first. */
export async function listProductLaunches(kv: Kv, productId: string): Promise<Slop[]> {
  const ids: string[] = [];
  for await (const entry of kv.list<string>({ prefix: ["launches_by_product", productId] })) ids.push(entry.value);
  return await getSlops(kv, ids);
}

/** All of a person's slops, newest first, including hidden ones. */
export async function listUserSlops(kv: Kv, userId: string): Promise<Slop[]> {
  const ids: string[] = [];
  for await (const entry of kv.list<string>(
    { prefix: ["slops_by_user", userId] },
    {
      reverse: true,
    },
  ))
    ids.push(entry.value);
  return await getSlops(kv, ids);
}
