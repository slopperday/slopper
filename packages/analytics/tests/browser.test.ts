// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Analytics, type AnalyticsOptions } from "../src/browser/client";
import { selectorOf } from "../src/browser/autocapture";
import { uuidv7 } from "../src/shared/uuid";
import type { WireBatch, WireEvent } from "../src/shared/events";
import type { RecorderHost } from "../src/browser/replay";
import { bucketOf } from "../src/shared/hash";

/** What the stand-in for web-vitals measured: the real one needs a browser's performance timeline. */
let measured: Record<string, number> | null = null;

vi.mock("../src/browser/vitals", () => ({
  Vitals: class {
    private taken = false;
    start() {}
    take() {
      if (this.taken || !measured) return null;
      this.taken = true;
      return measured;
    }
  },
}));

/** Recorders the client made: the real one needs rrweb, which these tests leave out. */
const recorders: { host: RecorderHost; started: boolean; pages: number; hidden: number; stopped: string | null }[] = [];

vi.mock("../src/browser/replay", () => ({
  Recorder: class {
    readonly record: (typeof recorders)[number];
    constructor(host: RecorderHost) {
      this.record = { host, started: false, pages: 0, hidden: 0, stopped: null };
      recorders.push(this.record);
    }
    start() {
      this.record.started = true;
    }
    pageChanged() {
      this.record.pages += 1;
    }
    pageHidden() {
      this.record.hidden += 1;
    }
    stop(discard = false) {
      this.record.stopped = discard ? "discarded" : "sent";
    }
  },
}));

const ENDPOINT = "https://happy-otter-123.convex.site/a";

interface Sent {
  url: string;
  init: RequestInit;
  batch: WireBatch;
}

let sent: Sent[] = [];
let status = 200;
let clients: Analytics[] = [];

const fakeFetch: typeof fetch = async (input, init = {}) => {
  if (status === 0) throw new TypeError("Failed to fetch");
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const body = typeof init.body === "string" ? init.body : "{}";
  sent.push({ url, init, batch: JSON.parse(body) as WireBatch });
  return new Response(null, { status });
};

function make(options: Partial<AnalyticsOptions> = {}): Analytics {
  const client = new Analytics({ endpoint: ENDPOINT, fetch: fakeFetch, flushIntervalMs: 50, ...options });
  clients.push(client);
  return client;
}

function clearCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

/** Every event sent so far, in order. */
function events(): WireEvent[] {
  return sent.flatMap((request) => request.batch.events);
}

function named(name: string): WireEvent[] {
  return events().filter((event) => event.name === name);
}

async function tick(ms = 0) {
  await new Promise((done) => setTimeout(done, ms));
}

beforeEach(() => {
  sent = [];
  recorders.length = 0;
  status = 200;
  // Beacons would reach the network; tests that look at them replace this.
  vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
  clearCookies();
  localStorage.clear();
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
});

afterEach(() => {
  for (const client of clients) client.shutdown();
  clients = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("uuidv7", () => {
  it("puts the time first, so ids sort by when they were made", () => {
    const early = uuidv7(Date.UTC(2026, 0, 1));
    const late = uuidv7(Date.UTC(2026, 9, 18));
    expect(early).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(early < late).toBe(true);
    expect(uuidv7(1)).not.toBe(uuidv7(1));
  });
});

describe("Analytics", () => {
  it("views the landing page with where the visit came from", async () => {
    history.replaceState(null, "", "/wall?utm_source=newsletter&utm_campaign=day-1&secret=abc");
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://news.ycombinator.com/");
    const client = make();
    await client.flush();
    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request?.url).toBe(`${ENDPOINT}/e`);
    expect(request?.init).toMatchObject({ method: "POST", credentials: "omit", keepalive: true });
    expect(new Headers(request?.init.headers).get("content-type")).toBe("text/plain");
    const [view] = named("$pageview");
    expect(view).toMatchObject({
      distinctId: client.distinctId,
      sessionId: client.sessionId,
      path: "/wall",
      properties: {
        referrer: "https://news.ycombinator.com/",
        utmSource: "newsletter",
        utmCampaign: "day-1",
      },
    });
    // The query string itself is never sent.
    expect(JSON.stringify(view)).not.toContain("secret");
  });

  it("remembers who's here across page loads, in a cookie the server can read", async () => {
    const first = make({ pageviews: false });
    const id = first.distinctId;
    expect(document.cookie).toContain(`sa_id=${id}`);
    first.capture("first");
    const session = first.sessionId;
    first.shutdown();
    const second = make({ pageviews: false });
    second.capture("second");
    await second.flush();
    expect(second.distinctId).toBe(id);
    expect(second.sessionId).toBe(session);
  });

  it("starts a new session after half an hour of quiet, and after a day of activity", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 18, 9));
    const client = make({ pageviews: false });
    client.capture("one");
    const first = client.sessionId;
    vi.setSystemTime(Date.UTC(2026, 9, 18, 9, 29));
    client.capture("two");
    expect(client.sessionId).toBe(first);
    vi.setSystemTime(Date.UTC(2026, 9, 18, 10, 0));
    client.capture("three");
    expect(client.sessionId).not.toBe(first);
    const second = client.sessionId;
    // Busy all day, never quiet for long.
    for (let minute = 20; minute <= 24 * 60 + 20; minute += 20) {
      vi.setSystemTime(Date.UTC(2026, 9, 18, 10, minute));
      client.capture("busy");
    }
    expect(client.sessionId).not.toBe(second);
  });

  it("batches events and sends a full batch at once", async () => {
    const client = make({ pageviews: false, batchSize: 3, flushIntervalMs: 60_000 });
    client.capture("a");
    client.capture("b");
    expect(sent).toHaveLength(0);
    client.capture("c");
    await tick();
    expect(sent).toHaveLength(1);
    expect(events().map((event) => event.name)).toEqual(["a", "b", "c"]);
  });

  it("sends what's waiting when the flush interval passes", async () => {
    const client = make({ pageviews: false, flushIntervalMs: 20 });
    client.capture("later");
    await tick(60);
    expect(named("later")).toHaveLength(1);
  });

  it("retries a failed send, and gives up on a batch the endpoint refused", async () => {
    const client = make({ pageviews: false });
    status = 0;
    client.capture("kept");
    await client.flush();
    expect(sent).toHaveLength(0);
    status = 200;
    await client.flush();
    expect(named("kept")).toHaveLength(1);

    status = 400;
    client.capture("refused");
    await client.flush();
    status = 200;
    await client.flush();
    expect(named("refused")).toHaveLength(1);
    expect(sent).toHaveLength(2);
  });

  it("stops retrying an event after three failures", async () => {
    const client = make({ pageviews: false });
    status = 503;
    client.capture("doomed");
    for (let attempt = 0; attempt < 4; attempt += 1) await client.flush();
    status = 200;
    await client.flush();
    expect(sent.filter((request) => request.batch.events.some((event) => event.name === "doomed"))).toHaveLength(3);
  });

  it("sends super properties with every event until they're removed", async () => {
    const client = make({ pageviews: false, properties: { country: "GB" } });
    client.register({ plan: "free" });
    client.capture("with", { extra: 1 });
    client.unregister("plan");
    client.capture("without");
    await client.flush();
    expect(named("with")[0]?.properties).toEqual({ country: "GB", plan: "free", extra: 1 });
    expect(named("without")[0]?.properties).toEqual({ country: "GB" });
  });

  it("identifies a visitor once, linking their anonymous id", async () => {
    const client = make({ pageviews: false });
    const anonymous = client.distinctId;
    client.identify("user-1", { username: "ifiok" });
    client.identify("user-1", { username: "ifiok" });
    client.capture("after");
    await client.flush();
    const identifies = named("$identify");
    expect(identifies).toHaveLength(1);
    expect(identifies[0]).toMatchObject({
      distinctId: "user-1",
      properties: { anonDistinctId: anonymous },
      set: { username: "ifiok" },
    });
    expect(named("after")[0]?.distinctId).toBe("user-1");
    expect(client.identified).toBe(true);
    expect(document.cookie).toContain("sa_id=user-1");
  });

  it("reports seeing a flag once a session, and again for another value or session", async () => {
    const client = make({ pageviews: false });
    client.flagSeen("wall-order", "newest");
    client.flagSeen("wall-order", "newest");
    // The next page in the same session remembers it was reported.
    const nextPage = make({ pageviews: false });
    nextPage.flagSeen("wall-order", "newest");
    nextPage.flagSeen("new-wall", false);
    await client.flush();
    await nextPage.flush();
    expect(named("$featureFlagCalled").map((event) => event.properties)).toEqual([
      { flag: "wall-order", variant: "newest" },
      { flag: "new-wall", variant: "false" },
    ]);
    nextPage.reset();
    nextPage.flagSeen("wall-order", "newest");
    await nextPage.flush();
    expect(named("$featureFlagCalled")).toHaveLength(3);
  });

  it("reports no flags for a browser that opted out", async () => {
    const client = make({ pageviews: false });
    client.optOut();
    client.flagSeen("wall-order", "newest");
    await client.flush();
    expect(named("$featureFlagCalled")).toEqual([]);
  });

  it("starts over as a new visitor on reset", async () => {
    const client = make({ pageviews: false });
    client.identify("user-1");
    client.register({ plan: "pro" });
    const session = client.sessionId;
    client.reset();
    client.capture("anonymous again");
    await client.flush();
    const [event] = named("anonymous again");
    expect(event?.distinctId).not.toBe("user-1");
    expect(event?.sessionId).not.toBe(session);
    expect(event?.properties).toEqual({});
    expect(client.identified).toBe(false);
  });

  it("captures nothing once this browser opts out, on later visits too", async () => {
    const client = make({ pageviews: false });
    client.capture("queued");
    client.optOut();
    client.capture("ignored");
    await client.flush();
    expect(sent).toHaveLength(0);
    expect(document.cookie).toContain("sa_off=1");
    expect(document.cookie).not.toContain("sa_id=");
    client.shutdown();

    const next = make();
    next.capture("still ignored");
    document.body.innerHTML = `<button>Click</button>`;
    document.querySelector("button")?.click();
    await next.flush();
    expect(sent).toHaveLength(0);
    expect(next.optedOut).toBe(true);

    next.optIn();
    next.capture("back");
    await next.flush();
    expect(named("back")).toHaveLength(1);
    expect(named("$pageview")).toHaveLength(1);
    expect(next.distinctId).not.toBe("");
  });

  it("rewrites private paths before they leave the browser", async () => {
    history.replaceState(null, "", "/unsubscribe/secret-token");
    document.body.innerHTML = `<a href="/unsubscribe/secret-token?x=1">Again</a>`;
    const client = make({ sanitizePath: (path) => path.replace(/^\/unsubscribe\/.+/, "/unsubscribe/:token") });
    document.querySelector("a")?.addEventListener("click", (event) => event.preventDefault());
    document.querySelector("a")?.click();
    await client.flush();
    expect(JSON.stringify(events())).not.toContain("secret-token");
    expect(named("$autocapture")[0]?.properties.href).toBe("/unsubscribe/:token");
  });
});

describe("page views", () => {
  it("records leaving a page and viewing the next on every history change", async () => {
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://google.com/");
    const client = make();
    history.pushState(null, "", "/wall");
    await tick();
    // Same path, different query: the same page.
    history.replaceState(null, "", "/wall?sort=hot");
    await tick();
    history.pushState(null, "", "/today");
    await tick();
    await client.flush();
    expect(events().map((event) => [event.name, event.path])).toEqual([
      ["$pageview", "/"],
      ["$pageleave", "/"],
      ["$pageview", "/wall"],
      ["$pageleave", "/wall"],
      ["$pageview", "/today"],
    ]);
    const views = named("$pageview");
    expect(views[0]?.properties.referrer).toBe("https://google.com/");
    expect(views[1]?.properties).toMatchObject({ previousPath: "/" });
    expect(views[1]?.properties.referrer).toBeUndefined();
    expect(named("$pageleave")[0]?.properties).toMatchObject({ duration: expect.any(Number) });
  });

  it("follows the back button", async () => {
    const client = make();
    history.pushState(null, "", "/wall");
    await tick();
    history.back();
    await tick(20);
    await client.flush();
    expect(named("$pageview").map((event) => event.path)).toEqual(["/", "/wall", "/"]);
  });

  it("hands the queue to the browser as the page goes away, leave included", () => {
    const beacons: { url: string; body: string }[] = [];
    const reads: Promise<void>[] = [];
    vi.spyOn(navigator, "sendBeacon").mockImplementation((url, data) => {
      reads.push((data as Blob).text().then((body) => void beacons.push({ url: String(url), body })));
      expect((data as Blob).type).toBe("text/plain");
      return true;
    });
    make({ flushIntervalMs: 60_000 });
    window.dispatchEvent(new Event("pagehide"));
    return Promise.all(reads).then(() => {
      expect(beacons).toHaveLength(1);
      expect(beacons[0]?.url).toBe(`${ENDPOINT}/e`);
      const batch = JSON.parse(beacons[0]?.body ?? "{}") as WireBatch;
      expect(batch.events.map((event) => event.name)).toEqual(["$pageview", "$pageleave"]);
      expect(sent).toHaveLength(0);
    });
  });

  it("keeps a page leave in the session it ended, even after the session went quiet", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 18, 9));
    const client = make();
    const session = client.sessionId;
    vi.setSystemTime(Date.UTC(2026, 9, 18, 11));
    vi.spyOn(navigator, "sendBeacon").mockReturnValue(false);
    window.dispatchEvent(new Event("pagehide"));
    await client.flush();
    expect(named("$pageleave")[0]?.sessionId).toBe(session);
  });
});

describe("autocapture", () => {
  it("records clicks on things people click, with where they landed", async () => {
    document.body.innerHTML = `<main><section id="hero"><button data-capture="launch" aria-label="Launch it">Launch <b>now</b></button></section></main>`;
    const client = make({ pageviews: false });
    document.querySelector("b")?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }));
    await client.flush();
    expect(named("$autocapture")[0]?.properties).toMatchObject({
      eventType: "click",
      tag: "button",
      text: "Launch now",
      selector: 'button[data-capture="launch"]',
      captureName: "launch",
      ariaLabel: "Launch it",
      viewportWidth: window.innerWidth,
      x: expect.any(Number),
      y: expect.any(Number),
    });
  });

  it("describes links by where they go, without query strings", async () => {
    document.body.innerHTML = `<nav><a href="https://example.com/docs?ref=1#top">Docs</a><a href="mailto:hi@slopper.day">Mail</a></nav>`;
    const client = make({ pageviews: false });
    for (const link of document.querySelectorAll("a")) {
      link.addEventListener("click", (event) => event.preventDefault());
      link.click();
    }
    await client.flush();
    expect(named("$autocapture").map((event) => event.properties.href)).toEqual(["https://example.com/docs", "mailto"]);
  });

  it("skips clicks on plain text and anything marked not to capture", async () => {
    document.body.innerHTML = `<p>Just words</p><div data-no-capture><button>Secret</button></div>`;
    const client = make({ pageviews: false });
    document.querySelector("p")?.click();
    document.querySelector("button")?.click();
    await client.flush();
    expect(named("$autocapture")).toHaveLength(0);
  });

  it("records field changes without their values, and never password fields", async () => {
    document.body.innerHTML = `<form><input name="tagline" value="typed secret"><input type="password" name="pw"><select name="category"><option>games</option></select></form>`;
    const client = make({ pageviews: false });
    for (const field of document.querySelectorAll("input, select"))
      field.dispatchEvent(new Event("change", { bubbles: true }));
    await client.flush();
    const changes = named("$autocapture");
    expect(changes.map((event) => event.properties.name)).toEqual(["tagline", "category"]);
    expect(JSON.stringify(changes)).not.toContain("typed secret");
    expect(changes[0]?.properties.text).toBeUndefined();
  });

  it("records form submissions with where they post and which button sent them", async () => {
    document.body.innerHTML = `<form action="/settings?tab=1" method="post"><button name="intent" value="profile">Save</button></form>`;
    const client = make({ pageviews: false });
    const form = document.querySelector("form");
    form?.addEventListener("submit", (event) => event.preventDefault());
    form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, submitter: document.querySelector("button") }));
    await client.flush();
    expect(named("$autocapture")[0]?.properties).toEqual({
      eventType: "submit",
      tag: "form",
      selector: "form",
      formAction: "/settings",
      formMethod: "post",
      text: "Save",
      intent: "profile",
    });
  });

  it("calls three quick clicks in one spot a rage click", async () => {
    document.body.innerHTML = `<div class="card">Nothing happens</div>`;
    const client = make({ pageviews: false });
    const card = document.querySelector("div");
    for (let n = 0; n < 4; n += 1) {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 100 + n, clientY: 100 }));
    }
    await client.flush();
    expect(named("$rageclick")).toHaveLength(1);
    expect(named("$rageclick")[0]?.properties).toMatchObject({ tag: "div", text: "Nothing happens" });
  });

  it("builds short selectors that stop at an id", () => {
    document.body.innerHTML = `<main><div id="board"><ul><li><span><a href="/">x</a></span></li></ul></div></main>`;
    const link = document.querySelector("a");
    expect(link && selectorOf(link)).toBe("ul > li > span > a");
    const inBoard = document.querySelector("ul");
    expect(inBoard && selectorOf(inBoard)).toBe("div#board > ul");
  });

  it("stops listening on shutdown", async () => {
    document.body.innerHTML = `<button>Go</button>`;
    const client = make({ pageviews: false });
    client.shutdown();
    document.querySelector("button")?.click();
    history.pushState(null, "", "/elsewhere");
    await tick();
    expect(events()).toHaveLength(0);
  });
});

describe("load cost", () => {
  it("stamps the landing page view with when the page was opened, not when the SDK arrived", async () => {
    const opened = Date.now() - 2_500;
    const client = make({ landedAt: opened });
    history.pushState(null, "", "/next");
    await tick();
    await client.flush();
    expect(named("$pageview")[0]?.timestamp).toBe(opened);
    expect(named("$pageleave")[0]?.properties.duration).toBeGreaterThanOrEqual(2_500);
  });

  it("never stamps a view in the future", async () => {
    const client = make({ landedAt: Date.now() + 60_000 });
    await client.flush();
    expect(named("$pageview")[0]?.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it("writes the session to storage once per burst of activity, not once per event", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.UTC(2026, 9, 18, 9));
    const client = make({ pageviews: false, autocapture: false });
    const writes = vi.spyOn(localStorage, "setItem");
    client.capture("first");
    for (let n = 0; n < 20; n += 1) {
      vi.setSystemTime(Date.UTC(2026, 9, 18, 9) + n * 100);
      client.capture(`burst ${n}`);
    }
    expect(writes.mock.calls.filter(([key]) => key === "sa_state")).toHaveLength(1);
    vi.setSystemTime(Date.UTC(2026, 9, 18, 9, 0, 10));
    client.capture("later");
    expect(writes.mock.calls.filter(([key]) => key === "sa_state")).toHaveLength(2);
    // Still one session throughout.
    await client.flush();
    expect(new Set(events().map((event) => event.sessionId)).size).toBe(1);
  });
});

describe("session replay", () => {
  /** Lets the recorder's dynamic import settle: done when no client is still loading one. */
  async function loaded() {
    await vi.waitFor(() => {
      if (clients.some((client) => client.replayLoading)) throw new Error("A recorder is still loading.");
    });
  }

  it("records no session unless replay is on, and every one at a rate of 1", async () => {
    make({ pageviews: true });
    make({ pageviews: true, replay: { sampleRate: 0 } });
    await loaded();
    expect(recorders).toEqual([]);
    const client = make({ pageviews: true, replay: { sampleRate: 1 } });
    await loaded();
    expect(recorders).toHaveLength(1);
    expect(recorders[0]?.started).toBe(true);
    expect(recorders[0]?.host.url).toBe(`${ENDPOINT}/r`);
    expect(recorders[0]?.host.identity()).toEqual({ distinctId: client.distinctId, sessionId: client.sessionId });
  });

  it("decides by the session, so every page of one agrees", async () => {
    const client = make({ pageviews: true, replay: { sampleRate: 0.5 } });
    const picked = bucketOf(`replay.${client.sessionId}`) < 0.5;
    // Vitest's module mocks can't serve two imports at once (browsers share the module): one page at a time.
    await loaded();
    // The next page in the same session.
    make({ pageviews: true, replay: { sampleRate: 0.5 } });
    await loaded();
    expect(recorders).toHaveLength(picked ? 2 : 0);
  });

  it("never records a page whose path holds a secret, nor one the app rules out", async () => {
    make({
      pageviews: true,
      sanitizePath: (path) => path.replace(/^\/unsubscribe\/[^/]+/, "/unsubscribe/:token"),
      replay: { sampleRate: 1, mayRecord: (path) => !path.startsWith("/settings") },
    });
    await loaded();
    const host = recorders[0]?.host;
    expect(host?.mayRecord("/wall")).toBe(true);
    expect(host?.mayRecord("/unsubscribe/abc")).toBe(false);
    expect(host?.mayRecord("/settings/api")).toBe(false);
  });

  it("follows navigation and the page going away, and stops for good on opting out", async () => {
    const client = make({ pageviews: true, replay: { sampleRate: 1 } });
    await loaded();
    const recorder = recorders[0];
    history.pushState(null, "", "/wall");
    await tick();
    expect(recorder?.pages).toBe(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(recorder?.hidden).toBe(1);
    client.optOut();
    expect(recorder?.stopped).toBe("discarded");
    expect(recorder?.host.identity()).toBeNull();
  });
});

describe("heatmaps", () => {
  function click(target: Element, pageX: number, pageY: number) {
    const event = new MouseEvent("click", { bubbles: true });
    Object.defineProperty(event, "pageX", { value: pageX });
    Object.defineProperty(event, "pageY", { value: pageY });
    target.dispatchEvent(event);
  }

  it("sends every click's spot on the page, per page, without private parts", async () => {
    document.body.innerHTML = '<p id="text">Plain words</p><div data-no-capture><button id="secret">x</button></div>';
    const client = make({ pageviews: true });
    const text = document.getElementById("text");
    const secret = document.getElementById("secret");
    if (!text || !secret) throw new Error("The page is missing.");
    click(text, 10.4, 20.6);
    click(text, 30, 40);
    click(secret, 1, 1);
    history.pushState(null, "", "/next");
    await tick();
    click(text, 5, 6);
    // Leaving a page sends its points (a hidden page's go with the beacon, which these tests stub out).
    history.pushState(null, "", "/last");
    await tick();
    await client.flush();
    const heatmaps = named("$heatmap");
    expect(heatmaps.map((event) => [event.path, event.properties.points])).toEqual([
      ["/", ["10,21", "30,40"]],
      ["/next", ["5,6"]],
    ]);
    expect(heatmaps[0]?.properties.viewportWidth).toBe(window.innerWidth);
    expect(named("$pageleave")[0]?.properties.viewportWidth).toBe(window.innerWidth);
  });

  it("sends a full batch of points at once, and none when turned off", async () => {
    document.body.innerHTML = "<p>Words</p>";
    const target = document.querySelector("p");
    if (!target) throw new Error("The page is missing.");
    const off = make({ pageviews: false, heatmaps: false });
    click(target, 1, 1);
    await off.flush();
    expect(named("$heatmap")).toEqual([]);
    off.shutdown();
    const client = make({ pageviews: false });
    for (let index = 0; index < 51; index += 1) click(target, index, index);
    await client.flush();
    expect(named("$heatmap").map((event) => event.properties.points)).toEqual([
      Array.from({ length: 50 }, (_, index) => `${index},${index}`),
    ]);
  });
});

describe("errors", () => {
  function throwUncaught(error: unknown, filename = "https://slopper.day/assets/root.js") {
    window.dispatchEvent(
      new ErrorEvent("error", { error, message: error instanceof Error ? error.message : String(error), filename }),
    );
  }

  it("records uncaught errors and rejections, once a minute each", async () => {
    const client = make({ pageviews: false });
    throwUncaught(new TypeError("x is undefined"));
    throwUncaught(new TypeError("x is undefined"));
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: new Error("Save failed for slop 42") });
    window.dispatchEvent(rejection);
    client.captureException(new Error("Caught it"), { boundary: "root" });
    await client.flush();
    expect(named("$exception").map((event) => [event.properties.type, event.properties.source])).toEqual([
      ["TypeError", "uncaught"],
      ["Error", "rejection"],
      ["Error", "reported"],
    ]);
    expect(named("$exception")[2]?.properties).toMatchObject({ message: "Caught it", boundary: "root" });
    expect(typeof named("$exception")[0]?.properties.fingerprint).toBe("string");
  });

  it("leaves out what the page can't act on, and stops at 25 a page", async () => {
    const client = make({ pageviews: false });
    throwUncaught(new Error("from an extension"), "chrome-extension://abc/content.js");
    throwUncaught("ResizeObserver loop completed with undelivered notifications.");
    window.dispatchEvent(new ErrorEvent("error", { error: null, message: "Script error.", filename: "" }));
    for (let index = 0; index < 30; index += 1) client.captureException(new Error(`distinct ${"x".repeat(index)}`));
    await client.flush();
    expect(named("$exception")).toHaveLength(25);
    expect(named("$exception").every((event) => event.properties.source === "reported")).toBe(true);
  });

  it("records none when turned off or opted out", async () => {
    const off = make({ pageviews: false, errors: false });
    throwUncaught(new Error("nobody hears this"));
    await off.flush();
    expect(named("$exception")).toEqual([]);
    off.shutdown();
    const client = make({ pageviews: false });
    client.optOut();
    client.captureException(new Error("nor this"));
    await client.flush();
    expect(named("$exception")).toEqual([]);
  });
});

describe("web vitals", () => {
  /** What beacons carried, decoded. */
  async function beaconed(spy: { mock: { calls: unknown[][] } }): Promise<WireEvent[]> {
    const batches = await Promise.all(
      spy.mock.calls.map(async ([, body]) =>
        body instanceof Blob ? (JSON.parse(await body.text()) as WireBatch) : null,
      ),
    );
    return batches.flatMap((batch) => batch?.events ?? []);
  }

  it("sends the landing page's vitals once, as it's hidden", async () => {
    measured = { lcp: 1800, cls: 0.02, inp: 80 };
    const beacon = vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
    history.replaceState(null, "", "/wall");
    make({ pageviews: false });
    await tick();
    history.pushState(null, "", "/today");
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    const vitals = (await beaconed(beacon)).filter((event) => event.name === "$webVitals");
    expect(vitals).toHaveLength(1);
    expect(vitals[0]).toMatchObject({ path: "/wall", properties: { lcp: 1800, cls: 0.02, inp: 80 } });
    measured = null;
  });

  it("sends the paint timings the browser has when it's left before web-vitals reports", async () => {
    const beacon = vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
    const named = vi
      .spyOn(performance, "getEntriesByName")
      .mockImplementation((name) =>
        name === "first-contentful-paint" ? [{ startTime: 312.4 } as PerformanceEntry] : [],
      );
    const typed = vi
      .spyOn(performance, "getEntriesByType")
      .mockImplementation((type) =>
        type === "navigation" ? [{ responseStart: 88.6 } as PerformanceNavigationTiming] : [],
      );
    history.replaceState(null, "", "/wall");
    make({ pageviews: false });
    // Hidden at once: web-vitals hasn't loaded yet.
    window.dispatchEvent(new Event("pagehide"));
    await tick();
    window.dispatchEvent(new Event("pagehide"));
    const vitals = (await beaconed(beacon)).filter((event) => event.name === "$webVitals");
    expect(vitals).toHaveLength(1);
    expect(vitals[0]).toMatchObject({ path: "/wall", properties: { fcp: 312, ttfb: 89 } });
    named.mockRestore();
    typed.mockRestore();
  });

  it("measures nothing when turned off", async () => {
    measured = { lcp: 1800 };
    const beacon = vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
    make({ pageviews: false, webVitals: false });
    await tick();
    window.dispatchEvent(new Event("pagehide"));
    expect((await beaconed(beacon)).filter((event) => event.name === "$webVitals")).toEqual([]);
    measured = null;
  });
});
