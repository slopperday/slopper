/**
 * Splitting long words into a thread. A line with only `---` always starts
 * a new post; otherwise posts break at paragraphs, then sentences, then
 * words, so each fits `limit` as `measure` counts it.
 */

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

export function splitThread(text: string, limit: number, measure: (value: string) => number): string[] {
  const posts: string[] = [];
  for (const chunk of text.split(/^\s*---\s*$/m)) {
    const trimmed = chunk.trim();
    if (trimmed) posts.push(...fit(trimmed, limit, measure));
  }
  return posts;
}

function fit(text: string, limit: number, measure: (value: string) => number): string[] {
  if (measure(text) <= limit) return [text];
  const pieces = text
    .split(/\n{2,}/)
    .flatMap((paragraph) => Array.from(segmenter.segment(paragraph), (part) => part.segment.trim()))
    .filter(Boolean);
  const posts: string[] = [];
  let current = "";
  for (const piece of pieces.flatMap((part) => (measure(part) <= limit ? [part] : byWords(part, limit, measure)))) {
    const next = current ? `${current} ${piece}` : piece;
    if (measure(next) <= limit) current = next;
    else {
      if (current) posts.push(current);
      current = piece;
    }
  }
  if (current) posts.push(current);
  return posts;
}

function byWords(text: string, limit: number, measure: (value: string) => number): string[] {
  const posts: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (measure(next) <= limit) current = next;
    else {
      if (current) posts.push(current);
      current = measure(word) <= limit ? word : word.slice(0, limit);
    }
  }
  if (current) posts.push(current);
  return posts;
}

/** Numbers each post "1/3" when there's more than one, keeping each within the limit. */
export function numberThread(posts: readonly string[]): string[] {
  if (posts.length < 2) return [...posts];
  return posts.map((post, index) => `${post} ${index + 1}/${posts.length}`);
}
