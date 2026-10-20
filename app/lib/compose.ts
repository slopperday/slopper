/**
 * Turns a Slopper moment (launch, update, re-serve) into text that fits each
 * network's limits. Links always survive truncation: the person's words give
 * way first.
 */

export interface PostContent {
  /** Plain text, without the link. */
  text: string;
  /** Canonical Slopper URL for the slop. */
  url: string;
  /** Link card title and description. */
  title: string;
  description: string;
  /** First screenshot URL, used as the link card image where supported. */
  imageUrl: string | null;
}

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/**
 * X's weighted length: Latin-ish code points weigh 1, everything else
 * (CJK, emoji) weighs 2, and every URL counts as 23.
 */
export function xWeightedLength(text: string): number {
  const urlPattern = /https?:\/\/\S+/g;
  let length = [...text.matchAll(urlPattern)].length * 23;
  const rest = text.replace(urlPattern, "");
  for (const char of rest) {
    const code = char.codePointAt(0)!;
    const light =
      code <= 4351 ||
      (code >= 8192 && code <= 8205) ||
      (code >= 8208 && code <= 8223) ||
      (code >= 8242 && code <= 8247);
    length += light ? 1 : 2;
  }
  return length;
}

export function graphemeLength(text: string): number {
  return graphemes(text).length;
}

/** Cuts `text` on a grapheme boundary so `measure(text) <= budget`. */
export function fitText(text: string, budget: number, measure: (value: string) => number): string {
  if (measure(text) <= budget) return text;
  const parts = graphemes(text);
  let low = 0;
  let high = parts.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = parts.slice(0, mid).join("").trimEnd() + "…";
    if (measure(candidate) <= budget) low = mid;
    else high = mid - 1;
  }
  return parts.slice(0, low).join("").trimEnd() + "…";
}

export type Network = "x" | "bluesky" | "linkedin";

const LIMITS: Record<Network, { budget: number; measure: (text: string) => number }> = {
  x: { budget: 280, measure: xWeightedLength },
  bluesky: { budget: 300, measure: graphemeLength },
  linkedin: { budget: 3000, measure: (text) => text.length },
};

/** The final text for `network`, with the link appended on its own line. */
export function composeFor(network: Network, content: PostContent): string {
  const { budget, measure } = LIMITS[network];
  const suffix = `\n\n${content.url}`;
  const room = budget - measure(suffix);
  return fitText(content.text.trim(), room, measure) + suffix;
}

/** Strips Markdown to readable plain text for social posts. */
export function markdownToPlain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Builds intent links so anyone can share without any API at all. */
export function shareIntents(text: string, url: string) {
  const enc = encodeURIComponent;
  return {
    x: `https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`,
    bluesky: `https://bsky.app/intent/compose?text=${enc(`${text} ${url}`)}`,
    // share-offsite ignores text; the feed composer prefills it and unfurls the link.
    linkedin: `https://www.linkedin.com/feed/?shareActive=true&text=${enc(`${text} ${url}`)}`,
    threads: `https://www.threads.net/intent/post?text=${enc(`${text} ${url}`)}`,
  };
}
