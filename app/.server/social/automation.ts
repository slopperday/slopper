import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { CSV_ROWS, csvPosts, wallTime } from "~/lib/csv";
import { feedPost, parseFeed } from "~/lib/feeds";
import { convex, convexMessage } from "../convex";
import { parseWebUrl } from "../forms";
import { fetchPublic, type PublicFetch } from "../preview";
import { saveStudioPost } from "./studio";

/**
 * Posts nobody writes by hand: new items from RSS and Atom feeds, and rows
 * of a spreadsheet scheduled in bulk. Both go through `saveStudioPost`, so
 * every one is checked like a post written in the composer.
 */

/** New items posted from one feed per run: a busy feed waits for the next run rather than flooding. */
const ITEMS_PER_RUN = 3;
const FEED_BYTES = 2 * 1024 * 1024;

async function readFeed(url: string, fetcher: PublicFetch) {
  const fetched = await fetcher(new URL(url), {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
    maxBytes: FEED_BYTES,
    truncate: false,
  });
  return parseFeed(new TextDecoder(fetched.charset ?? "utf-8").decode(fetched.bytes));
}

/** Adds a feed. What's in it now is marked seen, so only items published from here on are posted. */
export async function addFeed(
  user: Pick<Doc<"users">, "_id">,
  input: { url: string; accountIds: string[]; template: string; mode: "now" | "queue" },
  fetcher: PublicFetch = fetchPublic,
): Promise<string | null> {
  const url = parseWebUrl(input.url.trim());
  if (!url) return "That isn't a web address.";
  let items;
  try {
    items = await readFeed(url.href, fetcher);
  } catch {
    return "Couldn't read that feed. Check the address points at RSS or Atom.";
  }
  if (items.length === 0) return "That address has no RSS or Atom items.";
  try {
    await convex.mutation(api.studio.addFeed, {
      userId: user._id,
      url: url.href,
      accountIds: input.accountIds,
      template: input.template,
      mode: input.mode,
      seen: items.map((item) => item.id),
    });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return message;
    throw error;
  }
  return null;
}

/** Looks at the feeds that are due and posts their new items. Returns how many posts it made. */
export async function syncFeeds(fetcher: PublicFetch = fetchPublic): Promise<number> {
  const feeds = await convex.mutation(api.studio.claimFeeds, {});
  let made = 0;
  for (const feed of feeds) {
    let items;
    try {
      items = await readFeed(feed.url, fetcher);
    } catch {
      await convex.mutation(api.studio.recordFeed, { id: feed.id, seen: feed.seen, error: "Couldn't read the feed." });
      continue;
    }
    const user = await convex.query(api.users.get, { userId: feed.userId });
    if (!user) continue;
    const fresh = items.filter((item) => !feed.seen.includes(item.id)).slice(0, ITEMS_PER_RUN);
    const seen = [...fresh.map((item) => item.id), ...feed.seen];
    let error: string | null = null;
    // Oldest first, so they go out in the order they were published.
    for (const item of fresh.reverse()) {
      const result = await saveStudioPost(user, {
        text: feedPost(feed.template, item),
        link: "",
        productId: null,
        accountIds: feed.accountIds,
        media: [],
        frames: [],
        overrides: {},
        options: {},
        scheduledAt: null,
        queue: feed.mode === "queue",
        source: "rss",
        idempotencyKey: `rss:${feed.id}:${item.id}`.slice(0, 200),
      });
      if (result.ok) made++;
      else error = result.error;
    }
    await convex.mutation(api.studio.recordFeed, { id: feed.id, seen, error });
  }
  return made;
}

export interface ImportResult {
  row: number;
  ok: boolean;
  message: string;
  postId?: Id<"socialPosts">;
}

/** Schedules a spreadsheet's rows as posts for `accountIds`. Each row says how it went. */
export async function importCsv(
  user: Pick<Doc<"users">, "_id" | "timeZone">,
  csv: string,
  accountIds: string[],
): Promise<{ results: ImportResult[]; error: string | null }> {
  const { posts, error } = csvPosts(csv);
  if (error) return { results: [], error };
  if (posts.length === 0) return { results: [], error: "No rows with text." };
  if (posts.length > CSV_ROWS) return { results: [], error: `Up to ${CSV_ROWS} rows at a time.` };
  if (accountIds.length === 0) return { results: [], error: "Pick the accounts to post as." };
  const results: ImportResult[] = [];
  for (const post of posts) {
    const at = post.when ? wallTime(post.when, user.timeZone) : null;
    if (post.when && at === null) {
      results.push({ row: post.row, ok: false, message: `“${post.when}” isn't a time. Use 2026-11-24 09:30.` });
      continue;
    }
    const result = await saveStudioPost(user, {
      text: post.text,
      link: post.link,
      productId: null,
      accountIds,
      media: [],
      frames: [],
      overrides: {},
      options: {},
      scheduledAt: at,
      queue: at === null,
      tags: post.tags,
      firstComment: post.firstComment,
      source: "csv",
    });
    results.push(
      result.ok
        ? {
            row: post.row,
            ok: true,
            message: `Scheduled for ${new Date(result.scheduledAt ?? Date.now()).toISOString()}`,
            postId: result.postId,
          }
        : { row: post.row, ok: false, message: result.error },
    );
  }
  return { results, error: null };
}
