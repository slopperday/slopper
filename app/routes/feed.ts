import { getKv } from "~/.server/kv";
import { listRecentSlops } from "~/.server/db/slops";
import { getUsersById } from "~/.server/feed";
import { absoluteUrl } from "~/.server/config";
import { escapeHtml } from "~/.server/encoding";
import { memo } from "~/.server/memo";
import { slopPath } from "~/lib/display";

/** RSS 2.0 feed of the latest safe-for-work slops. */
export async function loader() {
  const kv = await getKv();
  const { items } = await memo("feed:rss", 60_000, () => listRecentSlops(kv, { limit: 40 }));
  const slops = items.filter((slop) => !slop.nsfw);
  const owners = await getUsersById(
    kv,
    slops.map((slop) => slop.userId),
  );
  const entries = slops.flatMap((slop) => {
    const owner = owners.get(slop.userId);
    if (!owner) return [];
    const link = absoluteUrl(slopPath(owner.username, slop.slug));
    return [
      `<item>
  <title>${escapeHtml(`${slop.name} by @${owner.username}`)}</title>
  <link>${escapeHtml(link)}</link>
  <guid isPermaLink="true">${escapeHtml(link)}</guid>
  <pubDate>${new Date(slop.launchedAt).toUTCString()}</pubDate>
  <description>${escapeHtml(slop.tagline)}</description>
</item>`,
    ];
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Slopper</title>
  <link>${escapeHtml(absoluteUrl("/"))}</link>
  <description>Fresh slop from people shipping every day.</description>
  ${entries.join("\n  ")}
</channel>
</rss>`;
  return new Response(xml, {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
