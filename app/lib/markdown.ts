import { escapeHtml as escape } from "./html";
import { Marked, type Tokens } from "marked";

/**
 * Markdown for descriptions, updates and comments. Raw HTML is escaped,
 * links are limited to http(s)/mailto and marked as user content, and
 * headings start at h3 so they never compete with the page title.
 */

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeHref(href: string): string | null {
  try {
    const url = new URL(href);
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escape(token.text);
    },
    heading(token: Tokens.Heading) {
      const level = Math.min(Math.max(token.depth + 2, 3), 6);
      return `<h${level}>${this.parser.parseInline(token.tokens)}</h${level}>`;
    },
    link(token: Tokens.Link) {
      const text = this.parser.parseInline(token.tokens);
      const href = safeHref(token.href);
      if (!href) return text;
      return `<a href="${escape(href)}" rel="nofollow ugc noopener" target="_blank">${text}</a>`;
    },
    image(token: Tokens.Image) {
      // Inline images would let anyone hotlink trackers; show a link.
      const href = safeHref(token.href);
      const label = escape(token.text || "image");
      if (!href) return label;
      return `<a href="${escape(href)}" rel="nofollow ugc noopener" target="_blank">🖼 ${label}</a>`;
    },
  },
});

export function renderMarkdown(markdown: string): string {
  return marked.parse(markdown) as string;
}
