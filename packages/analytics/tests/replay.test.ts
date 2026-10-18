// @vitest-environment happy-dom
import { gunzipSync, gzipSync } from "node:zlib";
import { EventType, type eventWithTime, IncrementalSource } from "@rrweb/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { type PageRecorder, type RecordOptions, Recorder, type RecorderHost } from "../src/browser/replay";
import { loadRecording } from "../src/player";
import { parseReplayChunkParams, REPLAY_LIMITS, replayChunkParams } from "../src/shared/replay";

/**
 * Session replay in the browser: what the recorder asks rrweb to hide, what
 * it sends and when, and the player's side of reading it back. rrweb itself
 * is a fake here that emits what it's told to.
 */

vi.mock("@rrweb/replay", () => ({ Replayer: class {} }));
vi.mock("@rrweb/replay/dist/style.css", () => ({}));

interface Sent {
  url: URL;
  init: RequestInit;
  events: eventWithTime[];
}

let sent: Sent[] = [];
let identity: { distinctId: string; sessionId: string } | null = null;

function meta(timestamp: number, href = "https://slopper.day/wall?q=secret#top"): eventWithTime {
  return { type: EventType.Meta, data: { href, width: 1280, height: 800 }, timestamp };
}

function snapshot(timestamp: number): eventWithTime {
  return {
    type: EventType.FullSnapshot,
    data: { node: { type: 0, childNodes: [], id: 1 }, initialOffset: { top: 0, left: 0 } },
    timestamp,
  };
}

function move(timestamp: number): eventWithTime {
  return {
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.MouseMove, positions: [{ x: 1, y: 2, id: 3, timeOffset: 0 }] },
    timestamp,
  };
}

function decode(body: BodyInit | null | undefined, gzip: boolean): eventWithTime[] {
  const bytes = typeof body === "string" ? Buffer.from(body) : body instanceof Uint8Array ? Buffer.from(body) : null;
  if (!bytes) throw new Error("A chunk was sent with a body the test can't read.");
  const parsed: unknown = JSON.parse((gzip ? gunzipSync(bytes) : bytes).toString("utf8"));
  if (!Array.isArray(parsed)) throw new Error("A chunk isn't a list.");
  return parsed.filter((event): event is eventWithTime => typeof event === "object" && event !== null);
}

const fakeFetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  sent.push({ url, init, events: decode(init.body, url.searchParams.get("z") === "1") });
  return new Response(null, { status: 200 });
};

/** A stand-in for rrweb's `record`: remembers its options and emits what a test hands it. */
function fakeRrweb() {
  const state: { options: RecordOptions | null; snapshots: number; stops: number } = {
    options: null,
    snapshots: 0,
    stops: 0,
  };
  const emit = (event: eventWithTime) => state.options?.emit?.(event);
  const recordPage: PageRecorder = Object.assign(
    (options: RecordOptions) => {
      state.options = options;
      return () => {
        state.stops += 1;
        state.options = null;
      };
    },
    {
      takeFullSnapshot: () => {
        state.snapshots += 1;
        emit(meta(Date.now()));
        emit(snapshot(Date.now()));
      },
    },
  );
  return { state, emit, recordPage };
}

function host(overrides: Partial<RecorderHost> = {}): RecorderHost {
  return {
    url: "https://x.convex.site/a/r",
    identity: () => identity,
    mayRecord: (path) => !path.startsWith("/settings"),
    sanitizePath: (path) => path.replace(/^\/unsubscribe\/[^/]+/, "/unsubscribe/:token"),
    fetch: fakeFetch,
    ...overrides,
  };
}

/** Lets compression and the fake send finish. */
async function settle() {
  for (let round = 0; round < 10; round += 1) await new Promise((done) => setTimeout(done, 0));
}

beforeEach(() => {
  sent = [];
  identity = { distinctId: "visitor-1", sessionId: "session-1" };
  history.replaceState(null, "", "/wall");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("replay chunk params", () => {
  it("round-trip, and refuse anything missing or out of order", () => {
    const meta = {
      sessionId: "s",
      distinctId: "d",
      startedAt: 10,
      endedAt: 20,
      events: 3,
      encoding: "gzip" as const,
      sentAt: 30,
    };
    expect(parseReplayChunkParams(replayChunkParams(meta))).toEqual(meta);
    const broken = (change: Record<string, string>) =>
      parseReplayChunkParams(new URLSearchParams({ ...Object.fromEntries(replayChunkParams(meta)), ...change }));
    expect(broken({ to: "5" })).toBeNull();
    expect(broken({ n: "0" })).toBeNull();
    expect(broken({ z: "2" })).toBeNull();
    expect(broken({ s: "" })).toBeNull();
    expect(broken({ from: "-1" })).toBeNull();
    expect(broken({ d: "x".repeat(REPLAY_LIMITS.idLength + 1) })).toBeNull();
  });
});

describe("Recorder", () => {
  it("asks rrweb to mask fields and block private parts and scripts", () => {
    const rrweb = fakeRrweb();
    new Recorder(host(), rrweb.recordPage).start();
    expect(rrweb.state.options).toMatchObject({
      maskAllInputs: true,
      blockSelector: "[data-no-capture], [data-no-replay], input[type=hidden]",
      maskTextSelector: "[data-sensitive]",
      slimDOMOptions: "all",
      inlineImages: false,
      recordCanvas: false,
    });
  });

  it("sends what it recorded, gzipped, filed under the session, with the address cleaned", async () => {
    const rrweb = fakeRrweb();
    const recorder = new Recorder(host(), rrweb.recordPage);
    recorder.start();
    rrweb.emit(meta(1_000, `${location.origin}/unsubscribe/abc123?x=1`));
    rrweb.emit(snapshot(1_001));
    rrweb.emit(move(1_500));
    await recorder.flush();
    expect(sent).toHaveLength(1);
    const [chunk] = sent;
    expect(chunk?.url.pathname).toBe("/a/r");
    expect(Object.fromEntries(chunk?.url.searchParams ?? [])).toMatchObject({
      s: "session-1",
      d: "visitor-1",
      from: "1000",
      to: "1500",
      n: "3",
      z: "1",
    });
    expect(chunk?.init.headers).toEqual({ "content-type": "text/plain" });
    expect(chunk?.init.credentials).toBe("omit");
    expect(chunk?.events.map((event) => event.type)).toEqual([
      EventType.Meta,
      EventType.FullSnapshot,
      EventType.IncrementalSnapshot,
    ]);
    expect(chunk?.events[0]).toMatchObject({ data: { href: `${location.origin}/unsubscribe/:token` } });
    // Nothing new, nothing sent.
    await recorder.flush();
    expect(sent).toHaveLength(1);
  });

  it("leaves query strings out of every link and form address it sends", async () => {
    const rrweb = fakeRrweb();
    const recorder = new Recorder(host(), rrweb.recordPage);
    recorder.start();
    rrweb.emit(meta(1));
    rrweb.emit({
      type: EventType.FullSnapshot,
      data: {
        node: {
          type: 2,
          tagName: "a",
          attributes: { href: `${location.origin}/wall?q=secret#main`, title: "?q=kept" },
          childNodes: [],
          id: 1,
        },
        initialOffset: { top: 0, left: 0 },
      },
      timestamp: 2,
    });
    rrweb.emit({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.Mutation,
        texts: [],
        removes: [],
        adds: [],
        attributes: [
          { id: 1, attributes: { href: "https://elsewhere.example/path?ref=slopper" } },
          { id: 2, attributes: { action: `${location.origin}/unsubscribe/abc?x=1` } },
          { id: 3, attributes: { href: "mailto:hello@slopper.day?subject=hi" } },
        ],
      },
      timestamp: 3,
    });
    await recorder.flush();
    const text = JSON.stringify(sent[0]?.events);
    expect(text).toContain(`"href":"${location.origin}/wall#main"`);
    expect(text).toContain('"title":"?q=kept"');
    expect(text).toContain('"href":"https://elsewhere.example/path"');
    expect(text).toContain(`"action":"${location.origin}/unsubscribe/:token"`);
    expect(text).toContain('"href":"mailto:hello@slopper.day?subject=hi"');
    expect(text).not.toContain("secret");
  });

  it("sends a full batch at once, and what's waiting on a timer", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const rrweb = fakeRrweb();
    new Recorder(host(), rrweb.recordPage).start();
    rrweb.emit(meta(1));
    rrweb.emit(snapshot(2));
    for (let index = 0; index < REPLAY_LIMITS.chunkEvents - 2; index += 1) rrweb.emit(move(3 + index));
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.events).toHaveLength(REPLAY_LIMITS.chunkEvents);
    rrweb.emit(move(5_000));
    vi.advanceTimersByTime(REPLAY_LIMITS.flushIntervalMs);
    await settle();
    expect(sent).toHaveLength(2);
  });

  it("starts each new session's recording with a full snapshot", async () => {
    const rrweb = fakeRrweb();
    const recorder = new Recorder(host(), rrweb.recordPage);
    recorder.start();
    rrweb.emit(meta(1));
    rrweb.emit(snapshot(2));
    identity = { distinctId: "visitor-1", sessionId: "session-2" };
    rrweb.emit(move(3));
    expect(rrweb.state.snapshots).toBe(1);
    await recorder.flush();
    await settle();
    const bySession = new Map(sent.map((chunk) => [chunk.url.searchParams.get("s") ?? "", chunk.events]));
    expect(bySession.get("session-1")?.map((event) => event.type)).toEqual([EventType.Meta, EventType.FullSnapshot]);
    // The move that came first in the new session is in its snapshot, not before it.
    expect(bySession.get("session-2")?.map((event) => event.type)).toEqual([EventType.Meta, EventType.FullSnapshot]);
  });

  it("files the rest of a session under someone's account once they sign in", async () => {
    const rrweb = fakeRrweb();
    const recorder = new Recorder(host(), rrweb.recordPage);
    recorder.start();
    rrweb.emit(meta(1));
    rrweb.emit(snapshot(2));
    identity = { distinctId: "user-1", sessionId: "session-1" };
    rrweb.emit(move(3));
    await recorder.flush();
    await settle();
    expect(sent.map((chunk) => [chunk.url.searchParams.get("d"), chunk.events.length])).toEqual([
      ["visitor-1", 2],
      ["user-1", 1],
    ]);
    expect(rrweb.state.snapshots).toBe(0);
  });

  it("records nothing while it may not, and pauses on private pages", async () => {
    const rrweb = fakeRrweb();
    history.replaceState(null, "", "/settings/api");
    const recorder = new Recorder(host(), rrweb.recordPage);
    recorder.start();
    expect(rrweb.state.options).toBeNull();

    history.replaceState(null, "", "/wall");
    recorder.pageChanged();
    expect(rrweb.state.options).not.toBeNull();
    rrweb.emit(meta(1));
    rrweb.emit(snapshot(2));
    // A private page drawn before navigation reports it is never kept.
    history.replaceState(null, "", "/settings");
    rrweb.emit(move(3));
    recorder.pageChanged();
    expect(rrweb.state.stops).toBe(1);
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.events).toHaveLength(2);

    // Opted out (or a session that isn't recorded): events are dropped as they come.
    history.replaceState(null, "", "/wall");
    recorder.pageChanged();
    identity = null;
    rrweb.emit(meta(3));
    await recorder.flush();
    expect(sent).toHaveLength(1);
  });

  it("sends uncompressed with keepalive as the page goes, and drops everything when stopped for good", async () => {
    const rrweb = fakeRrweb();
    const recorder = new Recorder(host(), rrweb.recordPage);
    recorder.start();
    rrweb.emit(meta(1));
    rrweb.emit(snapshot(2));
    recorder.pageHidden();
    await settle();
    expect(sent[0]?.url.searchParams.get("z")).toBe("0");
    expect(sent[0]?.init.keepalive).toBe(true);

    rrweb.emit(move(3));
    recorder.stop(true);
    await settle();
    expect(sent).toHaveLength(1);
    expect(rrweb.state.stops).toBe(1);
  });

  it("drops a send that fails rather than retrying it", async () => {
    const rrweb = fakeRrweb();
    const failing = new Recorder(
      host({
        fetch: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
      rrweb.recordPage,
    );
    failing.start();
    rrweb.emit(meta(1));
    await expect(failing.flush()).resolves.toBeUndefined();
    await failing.flush();
    expect(sent).toEqual([]);
  });
});

describe("loadRecording", () => {
  it("reads every chunk, gzipped or not, into one list in time order", async () => {
    const bodies: Record<string, Uint8Array> = {
      "https://storage/1": gzipSync(JSON.stringify([move(30), move(10)])),
      "https://storage/2": Buffer.from(JSON.stringify([meta(5), { not: "an event" }, snapshot(6)])),
    };
    const fetcher: typeof fetch = async (input) => {
      const body = bodies[typeof input === "string" ? input : input instanceof URL ? input.href : input.url];
      return body ? new Response(new Uint8Array(body)) : new Response(null, { status: 404 });
    };
    const events = await loadRecording(
      [
        { url: "https://storage/1", encoding: "gzip" },
        { url: "https://storage/2", encoding: "identity" },
      ],
      fetcher,
    );
    expect(events.map((event) => event.timestamp)).toEqual([5, 6, 10, 30]);
    await expect(loadRecording([{ url: "https://storage/gone", encoding: "gzip" }], fetcher)).rejects.toThrow(
      "A part of the recording didn't load (404).",
    );
  });
});
