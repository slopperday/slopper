import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { absoluteUrl } from "~/.server/config";
import { escapeHtml } from "~/.server/encoding";
import { launchTitle, slopPath } from "~/lib/display";

/** RSS 2.0 feed of the latest safe-for-work slops. */
export async function loader() {
  const { items } = await convex.query(api.slops.recent, { cursor: null, limit: 40 });
  const entries = items
    .filter(({ slop }) => !slop.nsfw)
    .map(({ slop, owner }) => {
      const link = absoluteUrl(slopPath(owner.username, slop.slug));
      return `<item>
  <title>${escapeHtml(`${launchTitle(slop)} by @${owner.username}`)}</title>
  <link>${escapeHtml(link)}</link>
  <guid isPermaLink="true">${escapeHtml(link)}</guid>
  <pubDate>${new Date(slop.launchedAt).toUTCString()}</pubDate>
  <description>${escapeHtml(slop.tagline)}</description>
</item>`;
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
