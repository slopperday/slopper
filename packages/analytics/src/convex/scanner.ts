import type { FunctionReturnType, GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component";
import { ANY_EVENT, type EventRow, type SessionRow, type TimeRange } from "../shared/insights";
import type { Channel } from "../shared/source";

export type ScanCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type EventsPage = FunctionReturnType<ComponentApi["scan"]["events"]>;
type SessionsPage = FunctionReturnType<ComponentApi["scan"]["sessions"]>;

/** Rows per page: one query each, well inside Convex's per-query read limits. */
export const PAGE_SIZE = 2_000;
/**
 * Most rows one insight reads. Past it the answer says it's `truncated`:
 * the numbers cover only what was read first.
 */
export const SCAN_LIMIT = 200_000;

/** Reads events and sessions page by page for the engines here, counting what it read. */
export class Scanner {
  scanned = 0;
  truncated = false;

  constructor(
    private readonly ctx: ScanCtx,
    private readonly component: ComponentApi,
  ) {}

  private full(): boolean {
    if (this.scanned >= SCAN_LIMIT) this.truncated = true;
    return this.truncated;
  }

  /**
   * Every occurrence of `name` in the range, oldest first; only one group's
   * with `group`. For `ANY_EVENT` without a group, every event, one name
   * after another (each oldest first).
   */
  async events(name: string, range: TimeRange, each: (row: EventRow) => void, group?: string): Promise<void> {
    if (name === ANY_EVENT && group === undefined) {
      for (const eventName of await this.ctx.runQuery(this.component.scan.eventNames, range)) {
        await this.events(eventName, range, each);
      }
      return;
    }
    let cursor: string | null = null;
    while (!this.full()) {
      const result: EventsPage = await this.ctx.runQuery(this.component.scan.events, {
        name: name === ANY_EVENT ? null : name,
        ...(group === undefined ? {} : { group }),
        from: range.from,
        to: range.to,
        cursor,
        numItems: PAGE_SIZE,
      });
      for (const row of result.page) each(row);
      this.scanned += result.page.length;
      if (result.isDone) return;
      cursor = result.continueCursor;
    }
  }

  /** Sessions that started in the range, oldest first. */
  async sessions(range: TimeRange, each: (row: SessionRow) => void): Promise<void> {
    let cursor: string | null = null;
    while (!this.full()) {
      const result: SessionsPage = await this.ctx.runQuery(this.component.scan.sessions, {
        from: range.from,
        to: range.to,
        cursor,
        numItems: PAGE_SIZE,
      });
      for (const session of result.page) {
        each({
          sessionId: session.sessionId,
          personId: session.personId,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          pageviews: session.pageviews,
          interactions: session.interactions,
          entryPath: session.entryPath,
          exitPath: session.exitPath,
          channel: session.source.channel,
          referrerDomain: session.source.referrerDomain,
          utmSource: session.source.utmSource,
          utmCampaign: session.source.utmCampaign,
          browser: session.device.browser,
          os: session.device.os,
          deviceType: session.device.deviceType,
          country: session.country,
        });
      }
      this.scanned += result.page.length;
      if (result.isDone) return;
      cursor = result.continueCursor;
    }
  }

  async sources(
    sessionIds: readonly string[],
    each: (sessionId: string, source: { referrerDomain: string | null; channel: Channel }) => void,
  ): Promise<void> {
    for (let start = 0; start < sessionIds.length; start += 500) {
      const found = await this.ctx.runQuery(this.component.scan.sessionSources, {
        sessionIds: sessionIds.slice(start, start + 500),
      });
      for (const { sessionId, source } of found) each(sessionId, source);
    }
  }

  async firstSeen(personIds: readonly string[]): Promise<Map<string, number>> {
    const seen = new Map<string, number>();
    for (let start = 0; start < personIds.length; start += 500) {
      const found = await this.ctx.runQuery(this.component.scan.firstSeen, {
        personIds: personIds.slice(start, start + 500),
      });
      for (const { personId, createdAt } of found) seen.set(personId, createdAt);
    }
    return seen;
  }
}
