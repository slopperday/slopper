import { record } from "@rrweb/record";
import { EventType, type eventWithTime } from "@rrweb/types";
import { REPLAY_LIMITS, replayChunkParams, type ReplayEncoding } from "../shared/replay";

/**
 * Session replay: records the page with rrweb and sends it in chunks.
 * client.ts imports this only for sessions picked to be recorded, after the
 * SDK itself has loaded, so it costs every other visit nothing.
 *
 * What's private stays in the browser: every field's value is masked,
 * hidden inputs and anything marked `data-no-capture` or `data-no-replay`
 * are blocked out (the replay shows an empty box their size), text marked
 * `data-sensitive` is masked, scripts (with the data pages hydrate from)
 * are left out, and pages the host says mayn't be recorded pause it.
 */

/** keepalive requests are capped near 64 KB; stay under it. */
const KEEPALIVE_BYTES = 60_000;

const BLOCKED = "[data-no-capture], [data-no-replay], input[type=hidden]";
/** Keys whose values are addresses: a page's (`Meta` events) and links' and forms' attributes. */
const URL_KEYS = new Set(["href", "action"]);
const MASKED_TEXT = "[data-sensitive]";

export interface RecorderHost {
  /** Where chunks go: the endpoint and `ROUTES.recordings`. */
  url: string;
  /** Who's being recorded, in which session; null while nothing may be recorded (opted out, or a session not picked). */
  identity(): { distinctId: string; sessionId: string } | null;
  /** Whether a page may be recorded, by its path as the browser has it. */
  mayRecord(path: string): boolean;
  /** Rewrites a path before it leaves the browser. */
  sanitizePath(path: string): string;
  fetch: typeof fetch;
}

type RecordOptions = NonNullable<Parameters<typeof record<eventWithTime>>[0]>;

/** What records a page: rrweb's `record` (tests pass a fake). */
export interface PageRecorder {
  (options: RecordOptions): (() => void) | undefined;
  takeFullSnapshot(isCheckout?: boolean): void;
}

export type { RecordOptions };

interface Pending {
  distinctId: string;
  sessionId: string;
  events: eventWithTime[];
}

async function gzip(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class Recorder {
  private pending: Pending | null = null;
  private stopRecording: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private readonly host: RecorderHost,
    private readonly recordPage: PageRecorder = record,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.flush(), REPLAY_LIMITS.flushIntervalMs);
    this.pageChanged();
  }

  /** Call on every navigation: a page that mayn't be recorded pauses the recording until one that may. */
  pageChanged(): void {
    if (this.stopped) return;
    const allowed = this.host.mayRecord(location.pathname);
    if (allowed && !this.stopRecording) {
      this.stopRecording =
        this.recordPage({
          emit: (event) => this.add(event),
          maskAllInputs: true,
          blockSelector: BLOCKED,
          maskTextSelector: MASKED_TEXT,
          slimDOMOptions: "all",
          inlineImages: false,
          recordCanvas: false,
          collectFonts: false,
          sampling: { scroll: 150, input: "last" },
        }) ?? null;
    } else if (!allowed && this.stopRecording) {
      this.stopRecording();
      this.stopRecording = null;
      void this.flush();
      // Coming back to a page that may be recorded starts with a fresh snapshot.
      this.pending = null;
    }
  }

  private add(event: eventWithTime): void {
    // The address changes before navigation tells `pageChanged` (a tick later), and the
    // new page may be drawn in between: nothing from a private page is kept even then.
    if (!this.host.mayRecord(location.pathname)) return;
    const who = this.host.identity();
    if (!who) {
      void this.flush();
      this.pending = null;
      return;
    }
    if (this.pending && this.pending.sessionId !== who.sessionId) {
      void this.flush();
      this.pending = null;
    } else if (this.pending && this.pending.distinctId !== who.distinctId) {
      // Signing in mid-session: the rest of the recording is theirs under their account's id.
      void this.flush();
      this.pending = { ...who, events: [] };
    }
    if (!this.pending) {
      this.pending = { ...who, events: [] };
      // Every session's recording starts with a full snapshot; a new one's first event may not be one.
      if (event.type !== EventType.Meta && event.type !== EventType.FullSnapshot) {
        this.recordPage.takeFullSnapshot();
        return;
      }
    }
    this.pending.events.push(event);
    if (this.pending.events.length >= REPLAY_LIMITS.chunkEvents) void this.flush();
  }

  /**
   * An address as it may leave the browser: without its query string, and
   * with this site's private path segments rewritten. rrweb records links
   * as full addresses, so even `#main` carries the page's query string.
   */
  private cleanUrl(value: string): string {
    if (!URL.canParse(value)) return value;
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return value;
    const path = url.origin === location.origin ? this.host.sanitizePath(url.pathname) : url.pathname;
    return `${url.origin}${path}${url.hash}`;
  }

  /**
   * Sends what's been recorded. As the page goes away (`keepalive`), it goes
   * uncompressed, since compressing takes a tick the page may not have.
   */
  async flush(keepalive = false): Promise<void> {
    const pending = this.pending;
    const first = pending?.events[0];
    const last = pending?.events.at(-1);
    if (!pending || !first || !last) return;
    this.pending = { ...pending, events: [] };
    // Addresses are cleaned as the chunk is written: the page's own (`Meta`), and every
    // link's and form's, wherever they sit in a snapshot or a change to the page.
    const json = JSON.stringify(pending.events, (key, value: unknown) =>
      URL_KEYS.has(key) && typeof value === "string" ? this.cleanUrl(value) : value,
    );
    if (new Blob([json]).size > REPLAY_LIMITS.expandedChunkBytes) return;
    const compress = !keepalive && typeof CompressionStream === "function";
    const body = compress ? await gzip(json) : json;
    const encoding: ReplayEncoding = compress ? "gzip" : "identity";
    const bytes = typeof body === "string" ? new Blob([body]).size : body.byteLength;
    // Bigger than the server takes: a gap in the replay is all it costs.
    if (bytes > REPLAY_LIMITS.chunkBytes) return;
    const params = replayChunkParams({
      sessionId: pending.sessionId,
      distinctId: pending.distinctId,
      startedAt: first.timestamp,
      endedAt: last.timestamp,
      events: pending.events.length,
      encoding,
      sentAt: Date.now(),
    });
    try {
      await this.host.fetch(`${this.host.url}?${params.toString()}`, {
        method: "POST",
        body,
        // text/plain keeps it a "simple" request: no CORS preflight.
        headers: { "content-type": "text/plain" },
        keepalive: keepalive && bytes <= KEEPALIVE_BYTES,
        credentials: "omit",
      });
    } catch {
      // Chunks aren't retried: a lost one is a gap in the replay, and resending
      // big chunks would spend the visitor's bandwidth on our recording.
    }
  }

  /** The page is being hidden or closed: send what's waiting while it still can. */
  pageHidden(): void {
    void this.flush(true);
  }

  /** Stops recording; `discard` drops what hasn't been sent (opting out) instead of sending it. */
  stop(discard = false): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.stopRecording?.();
    this.stopRecording = null;
    if (discard) this.pending = null;
    else void this.flush(true);
  }
}
