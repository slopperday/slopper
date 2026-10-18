import { EVENTS } from "../events";
import type { ErrorsQuery } from "./queries";
import type { EventRow } from "./rows";

/**
 * Errors grouped into issues by fingerprint (shared/errors.ts): how often,
 * how many people, when first and last, and where. Asked about one
 * fingerprint, it also lists that issue's latest occurrences.
 */

export interface ErrorIssue {
  fingerprint: string;
  type: string;
  /** The latest occurrence's message and stack. */
  message: string;
  stack: string | null;
  count: number;
  people: number;
  firstSeen: number;
  lastSeen: number;
  /** Where it happened most: a page's path, or the server. */
  paths: { path: string; count: number }[];
  sources: string[];
}

export interface ErrorOccurrence {
  timestamp: number;
  sessionId: string | null;
  path: string | null;
  message: string;
  source: string;
}

export interface ErrorsResult {
  kind: "errors";
  /** Most frequent first. */
  issues: ErrorIssue[];
  /** One issue's latest occurrences, when the query named one. */
  occurrences: ErrorOccurrence[];
  total: number;
}

const ISSUES = 100;
const OCCURRENCES = 50;
const PATHS = 3;

interface Gathering {
  issue: ErrorIssue;
  people: Set<string>;
  paths: Map<string, number>;
  sources: Set<string>;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

export class ErrorsAggregator {
  private readonly issues = new Map<string, Gathering>();
  private readonly occurrences: ErrorOccurrence[] = [];
  private total = 0;

  constructor(private readonly query: ErrorsQuery) {}

  add(event: EventRow): void {
    if (event.name !== EVENTS.exception) return;
    if (event.timestamp < this.query.range.from || event.timestamp >= this.query.range.to) return;
    const fingerprint = event.properties.fingerprint;
    if (typeof fingerprint !== "string" || !fingerprint) return;
    if (this.query.fingerprint !== undefined && fingerprint !== this.query.fingerprint) return;
    this.total += 1;
    const message = text(event.properties.message, "(no message)");
    const source = text(event.properties.source, "uncaught");
    const stack = typeof event.properties.stack === "string" ? event.properties.stack : null;
    let gathering = this.issues.get(fingerprint);
    if (!gathering) {
      gathering = {
        issue: {
          fingerprint,
          type: text(event.properties.type, "Error"),
          message,
          stack,
          count: 0,
          people: 0,
          firstSeen: event.timestamp,
          lastSeen: event.timestamp,
          paths: [],
          sources: [],
        },
        people: new Set(),
        paths: new Map(),
        sources: new Set(),
      };
      this.issues.set(fingerprint, gathering);
    }
    const { issue } = gathering;
    issue.count += 1;
    issue.firstSeen = Math.min(issue.firstSeen, event.timestamp);
    if (event.timestamp >= issue.lastSeen) {
      issue.lastSeen = event.timestamp;
      issue.message = message;
      issue.stack = stack ?? issue.stack;
    }
    gathering.people.add(event.personId);
    const where = event.path ?? (source === "server" ? "server" : "?");
    gathering.paths.set(where, (gathering.paths.get(where) ?? 0) + 1);
    gathering.sources.add(source);
    if (this.query.fingerprint !== undefined) {
      this.occurrences.push({
        timestamp: event.timestamp,
        sessionId: event.sessionId,
        path: event.path,
        message,
        source,
      });
    }
  }

  result(): ErrorsResult {
    const issues = [...this.issues.values()]
      .map(({ issue, people, paths, sources }) => ({
        ...issue,
        people: people.size,
        paths: [...paths]
          .map(([path, count]) => ({ path, count }))
          .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
          .slice(0, PATHS),
        sources: [...sources].sort(),
      }))
      .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
      .slice(0, ISSUES);
    const occurrences = this.occurrences.sort((a, b) => b.timestamp - a.timestamp).slice(0, OCCURRENCES);
    return { kind: "errors", issues, occurrences, total: this.total };
  }
}
