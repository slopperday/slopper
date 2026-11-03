/**
 * Bulk scheduling from a spreadsheet. Columns, by header: `text` (required),
 * `when` (an ISO time, or `YYYY-MM-DD HH:MM` in the person's time zone; empty
 * takes the next queue slot), `link`, `tags` (separated by spaces or commas)
 * and `first_comment`.
 */

/** Rows one spreadsheet can schedule: each is a content check. */
export const CSV_ROWS = 50;

export interface CsvPost {
  row: number;
  text: string;
  when: string;
  link: string;
  tags: string[];
  firstComment: string;
}

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and new lines. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

export function csvPosts(input: string): { posts: CsvPost[]; error: string | null } {
  const [header, ...rows] = parseCsv(input.replace(/^\uFEFF/, ""));
  if (!header) return { posts: [], error: "That file is empty." };
  const columns = header.map((name) => name.trim().toLowerCase().replace(/\s+/g, "_"));
  const at = (name: string) => columns.indexOf(name);
  if (at("text") < 0)
    return { posts: [], error: "The first row needs a text column (and optionally when, link, tags, first_comment)." };
  const posts = rows.map((cells, index) => {
    const cell = (name: string) => (at(name) >= 0 ? (cells[at(name)] ?? "").trim() : "");
    return {
      row: index + 2,
      text: cell("text"),
      when: cell("when"),
      link: cell("link"),
      tags: cell("tags")
        .split(/[\s,]+/)
        .filter(Boolean),
      firstComment: cell("first_comment"),
    };
  });
  return { posts: posts.filter((post) => post.text), error: null };
}

/**
 * Reads a time someone typed: ISO with a zone as it is, or "YYYY-MM-DD HH:MM"
 * as wall time in `timeZone`. Null when it isn't a time.
 */
export function wallTime(value: string, timeZone: string): number | null {
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(value)) {
    const at = Date.parse(value);
    return Number.isFinite(at) ? at : null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // The zone's offset at that moment: format the guess there and see how far off it reads.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return guess - (shown - guess);
}
