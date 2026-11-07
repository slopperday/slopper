import { Marked, type Token, type Tokens } from "marked";
import { renderMarkdown } from "./markdown";

/**
 * Markdown between Slopper's fields and the canvist editor.
 *
 * Slopper renders Markdown with `breaks: true`, so a single new line is a
 * line break. CommonMark, which canvist follows, folds it into a space, so
 * before the editor reads a field its line breaks become hard breaks (a
 * backslash before the new line), which both read the same way.
 */

const FENCE = /^\s{0,3}(```|~~~)/;
/** A line that starts a block of its own, so the line before it ends where it is. */
const BLOCK_START = /^\s{0,3}(#{1,6}\s|>|[-*+]\s|\d{1,9}[.)]\s|```|~~~|\||(?:[-*_]\s*){3,}$)/;

export function toEditorMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let fenced = false;
  return lines
    .map((line, index) => {
      if (FENCE.test(line)) {
        fenced = !fenced;
        return line;
      }
      const next = lines[index + 1];
      if (fenced || next === undefined || !line.trim() || !next.trim() || BLOCK_START.test(next)) return line;
      if (line.endsWith("\\")) return line;
      // A table row runs into the next one without a break.
      if (/^\s*\|/.test(line)) return line;
      return `${line.replace(/ {2,}$/, "")}\\`;
    })
    .join("\n");
}

/**
 * Whether `exported`, what the editor wrote back, reads exactly as
 * `original` does on Slopper. When it doesn't (a table, say, which the
 * editor has no block for), the field stays a plain text box, so nothing
 * anyone wrote is ever lost by opening it.
 */
export function readsTheSame(original: string, exported: string): boolean {
  return normalize(renderMarkdown(original)) === normalize(renderMarkdown(exported));
}

function normalize(html: string): string {
  return html.replace(/\s+/g, " ").replace(/> </g, "><").trim();
}

const lexer = new Marked({ gfm: true, breaks: true });
/** A backslash escape canvist writes: `\_`, `\[`, `\*`… */
const ESCAPE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g;

/**
 * canvist escapes more than Markdown needs (`snake\_case`, `\[note\]`, even
 * the `_` inside a bare URL, which breaks the link). Drop every escape that
 * reads the same without it, so what's stored, checked and auto-posted is
 * what the person wrote. An escape that matters (a literal `*b*`) stays.
 */
export function tidyEscapes(markdown: string): string {
  if (!markdown.includes("\\")) return markdown;
  const meaning = shape(markdown);
  const all = markdown.replace(ESCAPE, "$1");
  if (shape(all) === meaning) return all;
  // One at a time, keeping each removal that changes nothing.
  let current = markdown;
  const positions = [...markdown.matchAll(ESCAPE)].map((match) => match.index).slice(0, 100);
  let removed = 0;
  for (const position of positions) {
    const at = position - removed;
    const candidate = current.slice(0, at) + current.slice(at + 1);
    if (shape(candidate) === meaning) {
      current = candidate;
      removed++;
    }
  }
  return current;
}

/** What Markdown means, as marked reads it: block and inline structure and the text in it, escapes resolved. */
function shape(markdown: string): string {
  const out: string[] = [];
  const walk = (tokens: Token[], inLink = false) => {
    for (const token of tokens) {
      if (token.type === "space") continue;
      if (token.type === "text" || token.type === "escape") {
        const nested = (token as Tokens.Text).tokens;
        if (nested?.length) walk(nested, inLink);
        else out.push(`t:${inLink ? token.text.replace(/\\/g, "") : token.text}`);
        continue;
      }
      if (token.type === "link") {
        // The same address with a stray backslash is the same link.
        out.push(`link:${(token as Tokens.Link).href.replace(/\\/g, "")}`);
      } else if (token.type === "code" || token.type === "codespan") {
        out.push(`${token.type}:${token.text}`);
        continue;
      } else {
        out.push(token.type);
      }
      const children = "tokens" in token ? (token.tokens as Token[] | undefined) : undefined;
      if (children) walk(children, inLink || token.type === "link");
      if (token.type === "list") walk((token as Tokens.List).items, inLink);
      out.push("/");
    }
  };
  walk(lexer.lexer(markdown));
  // Adjacent text runs are one run, however marked split them.
  return out.join("\n").replace(/\nt:/g, "");
}
