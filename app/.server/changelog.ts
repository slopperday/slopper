import { renderMarkdown } from "~/lib/markdown";

/**
 * Release notes for /changelog. `monochange run release` writes one file per
 * release to app/changelog/ (the `user` output in monochange.toml) holding only
 * the user-facing changesets, so a release with nothing for users has no file.
 * They're bundled at build time, and a file that doesn't parse fails the build.
 */

export interface ReleaseNote {
  summary: string;
  /** The changeset body, rendered; null when the changeset is only a heading. */
  html: string | null;
}

export interface ReleaseSection {
  title: string;
  notes: ReleaseNote[];
}

export interface Release {
  version: string;
  /** The day the release was prepared, YYYY-MM-DD. */
  date: string;
  sections: ReleaseSection[];
}

// `changelog_version_title` in monochange.toml renders as "1.2.0 (2026-10-08)".
const TITLE = /^(\d+\.\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNote(entry: unknown, invalid: (problem: string) => Error): ReleaseNote {
  if (!isRecord(entry) || typeof entry.summary !== "string") throw invalid("every entry needs a summary");
  const details = entry.details_markdown ?? null;
  if (details !== null && typeof details !== "string") throw invalid("details_markdown must be text");
  return { summary: entry.summary, html: details ? renderMarkdown(details) : null };
}

function parseSection(section: unknown, invalid: (problem: string) => Error): ReleaseSection {
  if (!isRecord(section) || typeof section.title !== "string" || !Array.isArray(section.entries)) {
    throw invalid("every section needs a title and entries");
  }
  return { title: section.title, notes: section.entries.map((entry) => parseNote(entry, invalid)) };
}

/** Reads one monochange JSON release document; `file` ends in `<version>.json`. */
export function parseRelease(file: string, document: unknown): Release {
  const invalid = (problem: string) => new Error(`${file}: ${problem}`);
  if (!isRecord(document) || typeof document.title !== "string" || !Array.isArray(document.sections)) {
    throw invalid("expected monochange release notes with a title and sections");
  }
  const match = TITLE.exec(document.title);
  if (!match) throw invalid(`the title "${document.title}" isn't "<version> (<date>)"`);
  const [, version, date] = match;
  if (!file.endsWith(`/${version}.json`)) throw invalid(`the title says ${version}`);
  return { version, date, sections: document.sections.map((section) => parseSection(section, invalid)) };
}

function compareVersions(left: string, right: string): number {
  const [a, b] = [left, right].map((version) => version.split(".").map(Number));
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Every release, newest first. */
export function parseReleases(files: Record<string, unknown>): Release[] {
  return Object.entries(files)
    .map(([file, document]) => parseRelease(file, document))
    .sort((left, right) => compareVersions(right.version, left.version));
}

export const RELEASES: Release[] = parseReleases(
  import.meta.glob<unknown>("../changelog/*.json", { eager: true, import: "default" }),
);
