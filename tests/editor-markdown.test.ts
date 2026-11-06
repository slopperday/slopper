import { createEngine } from "@canvist/headless";
import { describe, expect, it } from "vite-plus/test";
import { readsTheSame, tidyEscapes, toEditorMarkdown } from "~/lib/editorMarkdown";
import { renderMarkdown } from "~/lib/markdown";

const engine = await createEngine();
/** What the editor writes back after reading a field, before anyone types. */
const throughEditor = (markdown: string) => engine.parse("markdown", toEditorMarkdown(markdown)).export("markdown");

describe("Markdown through the editor", () => {
  it("keeps single new lines as line breaks, the way Slopper shows them", () => {
    expect(toEditorMarkdown("Line one\nline two")).toBe("Line one\\\nline two");
    expect(toEditorMarkdown("Two spaces  \nnext")).toBe("Two spaces\\\nnext");
    expect(toEditorMarkdown("Para\n\nnext")).toBe("Para\n\nnext");
    expect(toEditorMarkdown("Intro\n- a\n- b")).toBe("Intro\n- a\n- b");
    expect(toEditorMarkdown("```\ncode\nmore\n```")).toBe("```\ncode\nmore\n```");
  });

  it("reads back the same for what people write", () => {
    for (const markdown of [
      "Built in 3 hours with Claude.\nShipped the next morning.",
      "## What's new\n\n- Level editor\n- Daily challenges\n\n1. Tilt\n2. Roll",
      "**bold** *italic* ~~gone~~ `code` and [a link](https://slopper.day)",
      "> A quote\n\n```js\nconst a = 1;\nconst b = 2;\n```\nAfter the code",
      "- [ ] a task\n- [x] done",
    ]) {
      expect(readsTheSame(markdown, throughEditor(markdown)), markdown).toBe(true);
    }
  });

  it("notices what the editor can't keep, so the field stays plain text", () => {
    const table = "| a | b |\n|---|---|\n| 1 | 2 |";
    expect(readsTheSame(table, throughEditor(table))).toBe(false);
  });
});

describe("tidying canvist's escapes", () => {
  const typed = (text: string) => {
    const doc = engine.create();
    doc.typeText(text);
    return tidyEscapes(doc.export("markdown"));
  };

  it("keeps what people typed, without backslashes they never wrote", () => {
    expect(typed("Not fit to print [e2e:blocked]")).toBe("Not fit to print [e2e:blocked]");
    expect(typed("snake_case and #hashtag, 50% off! a*b")).toBe("snake_case and #hashtag, 50% off! a*b");
    expect(typed("See https://slopper.day/x_y?a=1&b=2")).toBe("See https://slopper.day/x_y?a=1&b=2");
    expect(typed("Hello **world**")).toBe("Hello **world**");
  });

  it("keeps an escape that matters", () => {
    const literal = tidyEscapes("A \\*literal\\* star");
    expect(renderMarkdown(literal)).toBe(renderMarkdown("A \\*literal\\* star"));
    expect(renderMarkdown(literal)).not.toContain("<em>");
    expect(tidyEscapes("```\nC:\\_dir\n```")).toBe("```\nC:\\_dir\n```");
    expect(tidyEscapes("Use `a\\_b` here")).toBe("Use `a\\_b` here");
  });
});
