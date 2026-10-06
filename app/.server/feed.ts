import type { Kv } from "@deno/kv";
import { type PublicSlop, type PublicUser, publicSlop, publicUser, type Slop, type User } from "~/lib/model";
import { getManyValues } from "./kv";
import { getVotes, type Vote } from "./db/slops";

export type VoteMode = "vote" | "login" | "own";

/** A slop ready to render: who made it and how the viewer voted. */
export interface FeedItem {
  slop: PublicSlop;
  owner: PublicUser;
  vote: Vote;
  voteMode: VoteMode;
}

export async function getUsersById(kv: Kv, ids: Iterable<string>): Promise<Map<string, User>> {
  const unique = [...new Set(ids)];
  const users = await getManyValues<User>(
    kv,
    unique.map((id) => ["user", id]),
  );
  const map = new Map<string, User>();
  users.forEach((user, index) => {
    if (user) map.set(unique[index], user);
  });
  return map;
}

/** Whether `viewer` should see `slop` in a feed. */
export function isVisibleTo(slop: Slop, viewer: User | null): boolean {
  if (slop.hidden) return false;
  return !slop.nsfw || viewer?.showNsfw === true || viewer?.id === slop.userId;
}

/**
 * Attaches owners and votes. NSFW slops are dropped unless the viewer opted
 * in; owners always see their own.
 */
export async function toFeedItems(kv: Kv, slops: readonly Slop[], viewer: User | null): Promise<FeedItem[]> {
  const visible = slops.filter((slop) => isVisibleTo(slop, viewer) || viewer?.id === slop.userId);
  const owners = await getUsersById(
    kv,
    visible.map((slop) => slop.userId),
  );
  const votes = viewer
    ? await getVotes(
        kv,
        visible.map((slop) => slop.id),
        viewer.id,
      )
    : new Map<string, Vote>();
  const items: FeedItem[] = [];
  for (const slop of visible) {
    const owner = owners.get(slop.userId);
    if (owner) {
      items.push({
        slop: publicSlop(slop),
        owner: publicUser(owner),
        vote: votes.get(slop.id) ?? 0,
        voteMode: voteMode(viewer, slop),
      });
    }
  }
  return items;
}

export function voteMode(viewer: User | null, slop: Pick<Slop, "userId">): VoteMode {
  if (!viewer) return "login";
  return viewer.id === slop.userId ? "own" : "vote";
}
