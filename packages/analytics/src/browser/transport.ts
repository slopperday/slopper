import type { WireBatch, WireEvent } from "../shared/events";

/**
 * Sends events in batches. Events wait in memory until a batch fills or the
 * flush interval passes; a failed send keeps them for a few more tries, and
 * a page being hidden sends what's left with `sendBeacon`, which outlives
 * the page.
 *
 * Bodies go as text/plain: a "simple" cross-origin request needs no CORS
 * preflight, and `sendBeacon` can't make one at all.
 */

export interface TransportOptions {
  url: string;
  batchSize: number;
  flushIntervalMs: number;
  /** Events kept while sends fail; past this, the oldest go. */
  maxQueue: number;
  fetch: typeof fetch;
}

/** Tries per event before it's given up on. */
const MAX_ATTEMPTS = 3;
/** keepalive requests and beacons are capped near 64 KB; stay under it. */
const KEEPALIVE_BYTES = 60_000;

interface Queued {
  event: WireEvent;
  attempts: number;
}

export class Transport {
  private queue: Queued[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending: Promise<void> | null = null;

  constructor(private readonly options: TransportOptions) {}

  get pending(): number {
    return this.queue.length;
  }

  enqueue(event: WireEvent): void {
    this.queue.push({ event, attempts: 0 });
    if (this.queue.length > this.options.maxQueue) this.queue.splice(0, this.queue.length - this.options.maxQueue);
    if (this.queue.length >= this.options.batchSize) void this.flush();
    else this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.flushIntervalMs);
  }

  /** Sends everything queued, one batch at a time. Resolves when the sends are done. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.sending) await this.sending;
    if (this.queue.length === 0) return;
    this.sending = this.sendAll().finally(() => {
      this.sending = null;
    });
    await this.sending;
  }

  private async sendAll(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.options.batchSize);
      const ok = await this.send(batch.map((item) => item.event));
      if (ok) continue;
      // Put back what may still be retried, ahead of anything newer.
      const retry = batch.filter((item) => ++item.attempts < MAX_ATTEMPTS);
      this.queue.unshift(...retry);
      if (this.queue.length > 0) this.schedule();
      return;
    }
  }

  /** True when the batch was delivered, or rejected for good (a 4xx: retrying won't help). */
  private async send(events: WireEvent[]): Promise<boolean> {
    const body = JSON.stringify({ sentAt: Date.now(), events } satisfies WireBatch);
    try {
      const response = await this.options.fetch(this.options.url, {
        method: "POST",
        body,
        headers: { "content-type": "text/plain" },
        credentials: "omit",
        keepalive: body.length < KEEPALIVE_BYTES,
      });
      return response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429);
    } catch {
      return false;
    }
  }

  /**
   * The page is going away: hand everything to the browser to send. Splits
   * into beacons small enough to be accepted; anything refused stays queued
   * for a normal send if the page comes back.
   */
  beacon(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (typeof navigator.sendBeacon !== "function") {
      void this.flush();
      return;
    }
    const kept: Queued[] = [];
    let chunk: Queued[] = [];
    const sendChunk = () => {
      if (chunk.length === 0) return;
      const body = JSON.stringify({ sentAt: Date.now(), events: chunk.map((item) => item.event) } satisfies WireBatch);
      const sent = navigator.sendBeacon(this.options.url, new Blob([body], { type: "text/plain" }));
      if (!sent) kept.push(...chunk);
      chunk = [];
    };
    let size = 0;
    for (const item of this.queue) {
      const itemSize = JSON.stringify(item.event).length + 1;
      if (chunk.length > 0 && size + itemSize > KEEPALIVE_BYTES - 100) {
        sendChunk();
        size = 0;
      }
      chunk.push(item);
      size += itemSize;
    }
    sendChunk();
    this.queue = kept;
  }

  stop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.queue = [];
  }
}
