/**
 * Reading RSS and Atom feeds well enough to post their new items: each
 * item's id, title and link. Feeds are untrusted text; nothing here runs or
 * renders it, and titles are stripped to plain words.
 */

export interface FeedItem {
  id: string;
  title: string;
  link: string;
}

function decode(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return match ? decode(match[1]) : null;
}

/** The feed's items, newest first as feeds list them, up to 50. */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const block of blocks.slice(0, 50)) {
    const atomLink =
      /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(block)?.[1] ??
      /<link[^>]*href=["']([^"']+)["']/i.exec(block)?.[1];
    const link = (tag(block, "link") || atomLink || "").trim();
    const title = tag(block, "title") ?? "";
    const id = tag(block, "guid") ?? tag(block, "id") ?? link;
    if (!id || (!title && !link)) continue;
    items.push({ id: id.slice(0, 500), title: title.slice(0, 300), link: link.slice(0, 2000) });
  }
  return items;
}

/** A feed item's post, from the person's template with {title} and {link}. */
export function feedPost(template: string, item: FeedItem): string {
  return template
    .replace(/\{title\}/g, item.title)
    .replace(/\{link\}/g, item.link)
    .trim();
}
