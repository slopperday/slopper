import { describe, expect, it } from "vite-plus/test";
import { parseRelease, parseReleases, RELEASES } from "~/.server/changelog";
import { formatDate } from "~/lib/dates";

/** A release document as `monochange run release` writes it for the `user` output. */
function release(title: string, entries: Record<string, unknown>[] = [{ summary: "See what's new on Slopper" }]) {
  return {
    title,
    summary: [],
    sections: [
      {
        title: "New",
        collapsed: false,
        entries: entries.map((entry) => ({
          change_type: "user_feat",
          bump: "minor",
          stream: "user",
          style: "compact",
          provenance: { changeset_path: ".changeset/whats-new-page.md" },
          ...entry,
        })),
      },
    ],
  };
}

describe("changelog", () => {
  it("reads monochange's release notes", () => {
    const notes = release("1.1.0 (2026-10-08)", [
      { summary: "See what's new on Slopper", details_markdown: "Every **release**, newest first." },
      { summary: "Pin your best slop" },
    ]);
    expect(parseRelease("../changelog/1.1.0.json", notes)).toEqual({
      version: "1.1.0",
      date: "2026-10-08",
      sections: [
        {
          title: "New",
          notes: [
            { summary: "See what's new on Slopper", html: "<p>Every <strong>release</strong>, newest first.</p>\n" },
            { summary: "Pin your best slop", html: null },
          ],
        },
      ],
    });
  });

  it("escapes HTML in release notes", () => {
    const notes = release("1.1.0 (2026-10-08)", [{ summary: "Safe", details_markdown: "<script>alert(1)</script>" }]);
    expect(parseRelease("../changelog/1.1.0.json", notes).sections[0].notes[0].html).not.toContain("<script>");
  });

  it("lists releases newest first, comparing versions as numbers", () => {
    const releases = parseReleases({
      "../changelog/1.9.0.json": release("1.9.0 (2026-10-09)"),
      "../changelog/1.10.0.json": release("1.10.0 (2026-10-10)"),
      "../changelog/1.2.3.json": release("1.2.3 (2026-10-01)"),
    });
    expect(releases.map((entry) => entry.version)).toEqual(["1.10.0", "1.9.0", "1.2.3"]);
  });

  it("refuses notes it can't read, naming the file", () => {
    expect(() => parseRelease("../changelog/1.1.0.json", null)).toThrow(
      "../changelog/1.1.0.json: expected monochange release notes with a title and sections",
    );
    expect(() => parseRelease("../changelog/1.1.0.json", release("1.1.0"))).toThrow(
      `the title "1.1.0" isn't "<version> (<date>)"`,
    );
    expect(() => parseRelease("../changelog/1.2.0.json", release("1.1.0 (2026-10-08)"))).toThrow(
      "the title says 1.1.0",
    );
    expect(() => parseRelease("../changelog/1.1.0.json", release("1.1.0 (2026-10-08)", [{ summary: 3 }]))).toThrow(
      "every entry needs a summary",
    );
    expect(() =>
      parseRelease("../changelog/1.1.0.json", release("1.1.0 (2026-10-08)", [{ summary: "Hi", details_markdown: 1 }])),
    ).toThrow("details_markdown must be text");
  });

  it("bundles only releases that have something for users", () => {
    // Importing RELEASES already parsed every file in app/changelog/.
    for (const entry of RELEASES) {
      expect(entry.sections.flatMap((section) => section.notes).length).toBeGreaterThan(0);
    }
  });

  it("dates releases in words", () => {
    expect(formatDate("2026-10-08")).toBe("8 October 2026");
  });
});
