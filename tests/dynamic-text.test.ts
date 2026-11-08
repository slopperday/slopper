import { describe, expect, it } from "vite-plus/test";
import {
  fromEditorDoc,
  hasDynamic,
  parseDynamic,
  type Person,
  personOn,
  resolveFor,
  taggedKeys,
  toEditorDoc,
  unhandled,
  writeDynamic,
} from "~/lib/dynamicText";

const ada: Person = {
  key: "ada",
  name: "Ada Lovelace",
  handles: { bluesky: "ada.bsky.social", instagram: "@ada_builds", reddit: "u/adal", mastodon: "ada@hachyderm.io" },
};
const sam: Person = { key: "sam", name: "Sam", handles: { x: "samwrites" } };

describe("words that change with the network", () => {
  const post = "Thanks {{@ada}} and {{@sam}}!{{only threads instagram}} Link in bio.{{/only}}";

  it("tags each person the way their network does, or by name", () => {
    expect(resolveFor(post, "bluesky", [ada, sam])).toBe("Thanks @ada.bsky.social and Sam!");
    expect(resolveFor(post, "instagram", [ada, sam])).toBe("Thanks @ada_builds and Sam! Link in bio.");
    expect(resolveFor(post, "x", [ada, sam])).toBe("Thanks Ada Lovelace and @samwrites!");
    expect(resolveFor(post, "threads", [ada, sam])).toBe("Thanks Ada Lovelace and Sam! Link in bio.");
    expect(personOn(ada, "reddit")).toBe("u/adal");
    expect(personOn(ada, "mastodon")).toBe("@ada@hachyderm.io");
    expect(personOn({ ...ada, handles: { linkedin: "Ada L." } }, "linkedin")).toBe("Ada L.");
  });

  it("keeps a person it doesn't know as their key, and plain words as they are", () => {
    expect(resolveFor("Hi {{@nobody}}", "x", [])).toBe("Hi nobody");
    expect(resolveFor("Hi {there|you} {date}", "x")).toBe("Hi {there|you} {date}");
    expect(hasDynamic("Hi {there|you} {{ nope }}")).toBe(false);
  });

  it("gives words for networks it doesn't know to everyone", () => {
    expect(resolveFor("A{{only myspace}}B{{/only}}", "x")).toBe("AB");
    expect(resolveFor("A{{only X, Bluesky}}B{{/only}}", "bluesky")).toBe("AB");
    expect(resolveFor("A{{only x,bluesky}}B{{/only}}", "linkedin")).toBe("A");
  });

  it("writes back what it parses", () => {
    for (const text of [
      post,
      "plain",
      "",
      "{{only x}}{{@sam}}{{/only}}\nnext line",
      "a{{only x bluesky}}b{{/only}}c",
    ]) {
      expect(writeDynamic(parseDynamic(text))).toBe(text);
    }
    expect(writeDynamic(parseDynamic("{{only x bluesky}}a{{/only}}{{only bluesky x}}b{{/only}}"))).toBe(
      "{{only x bluesky}}ab{{/only}}",
    );
  });

  it("lists who is tagged, and who has no handle where it goes", () => {
    expect(taggedKeys(post + " {{@ada}}")).toEqual(["ada", "sam"]);
    expect(unhandled(post, "x", [ada, sam]).map((person) => person.key)).toEqual(["ada"]);
    expect(unhandled("{{only bluesky}}{{@sam}}{{/only}}", "x", [sam])).toEqual([]);
  });
});

describe("the composer's canvist document", () => {
  it("makes a paragraph per line, chips for people and marks for networks", () => {
    expect(toEditorDoc("Hi {{@ada}}\n\n{{only x}}For X{{/only}}", [ada])).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hi " },
            { type: "mention", attrs: { id: "ada", label: "Ada Lovelace", mentionSuggestionChar: "@" } },
          ],
        },
        { type: "paragraph" },
        {
          type: "paragraph",
          content: [{ type: "text", text: "For X", marks: [{ type: "conditional", attrs: { when: "x" } }] }],
        },
      ],
    });
  });

  it("round-trips the stored words", () => {
    for (const text of [
      "Thanks {{@ada}}!{{only threads instagram}} Link in bio.{{/only}}",
      "one\ntwo\n\nthree",
      "{{only bluesky}}{{@ada}} line\nand the next{{/only}}",
      "",
    ]) {
      expect(fromEditorDoc(toEditorDoc(text, [ada]))).toBe(text);
    }
  });

  it("reads hard breaks, other marks and chips it didn't make", () => {
    expect(
      fromEditorDoc({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "a", marks: [{ type: "bold" }] },
              { type: "hardBreak" },
              { type: "mention", attrs: { id: "Not A Key", label: "Zed" } },
              { type: "text", text: "!", marks: [{ type: "conditional", attrs: { when: "x" } }] },
            ],
          },
        ],
      }),
    ).toBe("a\n@Zed{{only x}}!{{/only}}");
  });
});
