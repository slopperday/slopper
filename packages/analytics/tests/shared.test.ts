import { describe, expect, it } from "vite-plus/test";
import { BATCH_LIMITS, parseBatch } from "../src/shared/events";
import { isPropertyKey, normalizeProperties, PROPERTY_LIMITS } from "../src/shared/properties";
import { cookieNames } from "../src/shared/routes";
import { hostOf, trafficSource } from "../src/shared/source";
import { isBot, parseUserAgent } from "../src/shared/userAgent";

const NOW = Date.UTC(2026, 9, 18, 12);

function wire(overrides: Record<string, unknown> = {}) {
  return {
    uuid: "0192f000-0000-7000-8000-000000000001",
    name: "$pageview",
    distinctId: "visitor-1",
    sessionId: "session-1",
    timestamp: NOW - 1_000,
    path: "/wall",
    properties: { title: "Wall" },
    ...overrides,
  };
}

describe("properties", () => {
  it("keeps scalars and lists of strings under identifier keys", () => {
    expect(
      normalizeProperties({
        plan: "free",
        count: 3,
        on: true,
        none: null,
        tags: ["a", "b"],
        utm_source: "x",
      }),
    ).toEqual({ plan: "free", count: 3, on: true, none: null, tags: ["a", "b"], utm_source: "x" });
  });

  it("drops what Convex can't store or filter on", () => {
    expect(
      normalizeProperties({
        $set: "reserved",
        _id: "reserved",
        "has space": 1,
        "9lives": 1,
        nested: { a: 1 },
        mixed: ["a", 1],
        nan: Number.NaN,
        infinite: Number.POSITIVE_INFINITY,
        fn: () => 1,
        missing: undefined,
      }),
    ).toEqual({});
  });

  it("isn't fooled by non-objects", () => {
    expect(normalizeProperties(null)).toEqual({});
    expect(normalizeProperties("text")).toEqual({});
    expect(normalizeProperties(["a"])).toEqual({});
  });

  it("cuts long values and stops at the property limit", () => {
    const long = "x".repeat(PROPERTY_LIMITS.stringLength + 10);
    const many = Object.fromEntries(Array.from({ length: PROPERTY_LIMITS.count + 5 }, (_, n) => [`key${n}`, n]));
    expect(normalizeProperties({ long }).long).toHaveLength(PROPERTY_LIMITS.stringLength);
    expect(Object.keys(normalizeProperties(many))).toHaveLength(PROPERTY_LIMITS.count);
    const list = Array.from({ length: PROPERTY_LIMITS.listLength + 3 }, (_, n) => `item${n}`);
    expect(normalizeProperties({ list }).list).toHaveLength(PROPERTY_LIMITS.listLength);
  });

  it("accepts identifier keys only", () => {
    expect(isPropertyKey("utmSource")).toBe(true);
    expect(isPropertyKey("a".repeat(PROPERTY_LIMITS.keyLength + 1))).toBe(false);
    expect(isPropertyKey("$pageview")).toBe(false);
    expect(isPropertyKey("")).toBe(false);
  });
});

describe("parseBatch", () => {
  it("takes valid events as they are", () => {
    const batch = parseBatch({ sentAt: NOW, events: [wire()] }, NOW);
    expect(batch).toEqual({
      dropped: 0,
      events: [
        {
          uuid: "0192f000-0000-7000-8000-000000000001",
          name: "$pageview",
          distinctId: "visitor-1",
          sessionId: "session-1",
          timestamp: NOW - 1_000,
          path: "/wall",
          properties: { title: "Wall" },
          set: null,
          setOnce: null,
        },
      ],
    });
  });

  it("corrects a sender's clock by the gap between when it sent and when the batch arrived", () => {
    // The browser's clock runs an hour behind: its "now" is the server's now minus an hour.
    const behind = NOW - 3_600_000;
    const batch = parseBatch({ sentAt: behind, events: [wire({ timestamp: behind - 5_000 })] }, NOW);
    expect(batch.events[0]?.timestamp).toBe(NOW - 5_000);
  });

  it("puts events from the future at now, and drops ones older than a week", () => {
    const batch = parseBatch(
      {
        events: [
          wire({ uuid: "future", timestamp: NOW + 60_000 }),
          wire({ uuid: "ancient", timestamp: NOW - BATCH_LIMITS.maxAgeMs - 1 }),
        ],
      },
      NOW,
    );
    expect(batch.events.map((event) => [event.uuid, event.timestamp])).toEqual([["future", NOW]]);
    expect(batch.dropped).toBe(1);
  });

  it("drops malformed events one by one", () => {
    const batch = parseBatch(
      {
        sentAt: NOW,
        events: [
          wire({ uuid: "ok" }),
          wire({ uuid: "" }),
          wire({ name: 42 }),
          wire({ distinctId: " " }),
          wire({ timestamp: "yesterday" }),
          wire({ name: "x".repeat(BATCH_LIMITS.nameLength + 1) }),
          "not an event",
          null,
        ],
      },
      NOW,
    );
    expect(batch.events.map((event) => event.uuid)).toEqual(["ok"]);
    expect(batch.dropped).toBe(7);
  });

  it("keeps person properties only when there are some", () => {
    const [event] = parseBatch(
      { sentAt: NOW, events: [wire({ set: { username: "ifiok" }, setOnce: { "bad key": 1 } })] },
      NOW,
    ).events;
    expect(event?.set).toEqual({ username: "ifiok" });
    expect(event?.setOnce).toBeNull();
  });

  it("caps a batch", () => {
    const events = Array.from({ length: BATCH_LIMITS.events + 4 }, (_, n) => wire({ uuid: `e${n}` }));
    const batch = parseBatch({ sentAt: NOW, events }, NOW);
    expect(batch.events).toHaveLength(BATCH_LIMITS.events);
    expect(batch.dropped).toBe(4);
  });

  it("returns nothing for something that isn't a batch", () => {
    expect(parseBatch(null, NOW)).toEqual({ events: [], dropped: 0 });
    expect(parseBatch({ events: "no" }, NOW)).toEqual({ events: [], dropped: 0 });
  });
});

describe("parseUserAgent", () => {
  const cases: [string, string, ReturnType<typeof parseUserAgent>][] = [
    [
      "Chrome on macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      { browser: "Chrome", browserVersion: "141", os: "macOS", osVersion: "10", deviceType: "desktop" },
    ],
    [
      "Safari on iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
      { browser: "Safari", browserVersion: "18", os: "iOS", osVersion: "18", deviceType: "mobile" },
    ],
    [
      "Firefox on Windows 11",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
      { browser: "Firefox", browserVersion: "143", os: "Windows", osVersion: "10", deviceType: "desktop" },
    ],
    [
      "Edge, which also says Chrome",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.71",
      { browser: "Edge", browserVersion: "141", os: "Windows", osVersion: "10", deviceType: "desktop" },
    ],
    [
      "Samsung Internet on an Android phone",
      "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
      { browser: "Samsung Internet", browserVersion: "28", os: "Android", osVersion: "14", deviceType: "mobile" },
    ],
    [
      "Chrome on an Android tablet",
      "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      { browser: "Chrome", browserVersion: "141", os: "Android", osVersion: "13", deviceType: "tablet" },
    ],
    [
      "Instagram's in-app browser",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0.0",
      { browser: "Instagram", browserVersion: "390", os: "iOS", osVersion: "18", deviceType: "mobile" },
    ],
    [
      "Chrome on ChromeOS",
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      { browser: "Chrome", browserVersion: "141", os: "ChromeOS", osVersion: null, deviceType: "desktop" },
    ],
    ["nothing at all", "", { browser: null, browserVersion: null, os: null, osVersion: null, deviceType: null }],
  ];
  for (const [label, userAgent, expected] of cases) {
    it(`reads ${label}`, () => expect(parseUserAgent(userAgent)).toEqual(expected));
  }
});

describe("isBot", () => {
  it("knows crawlers, previews and scripts", () => {
    for (const userAgent of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "curl/8.7.1",
      "python-requests/2.32.3",
      "",
    ]) {
      expect(isBot(userAgent), userAgent).toBe(true);
    }
  });

  it("lets people's browsers through", () => {
    expect(
      isBot(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });
});

describe("trafficSource", () => {
  const source = (referrer: string | null, utm: Record<string, string> = {}) =>
    trafficSource({ referrer, ownHost: "slopper.day", ...utm });

  it("sorts referrers into channels", () => {
    expect(source(null)).toMatchObject({ channel: "direct", referrerDomain: null });
    expect(source("https://www.google.com/")).toMatchObject({ channel: "search", referrerDomain: "google.com" });
    expect(source("https://t.co/abc")).toMatchObject({ channel: "social", referrerDomain: "t.co" });
    expect(source("https://news.ycombinator.com/item?id=1")).toMatchObject({ channel: "social" });
    expect(source("https://mail.google.com/mail/u/0/")).toMatchObject({ channel: "email" });
    expect(source("https://someones.blog/post")).toMatchObject({
      channel: "referral",
      referrerDomain: "someones.blog",
    });
    expect(source("https://www.slopper.day/wall")).toMatchObject({ channel: "internal" });
  });

  it("lets UTM tags say what a link was for", () => {
    expect(source("https://t.co/abc", { utmMedium: "cpc", utmSource: "x" })).toMatchObject({
      channel: "paid",
      utmSource: "x",
      utmMedium: "cpc",
    });
    expect(source(null, { utmMedium: "Newsletter" })).toMatchObject({ channel: "email", utmMedium: "newsletter" });
    expect(source(null, { utmSource: "reddit.com" })).toMatchObject({ channel: "social" });
    expect(source(null, { utmSource: "launch-list", utmCampaign: "Day 1" })).toMatchObject({
      channel: "referral",
      utmCampaign: "day 1",
    });
  });

  it("reads hosts without www", () => {
    expect(hostOf("https://WWW.Example.com/path")).toBe("example.com");
    expect(hostOf("not a url")).toBeNull();
  });
});

describe("cookieNames", () => {
  it("names the distinct id and opt-out cookies after the storage key", () => {
    expect(cookieNames()).toEqual({ distinctId: "sa_id", optOut: "sa_off" });
    expect(cookieNames("app")).toEqual({ distinctId: "app_id", optOut: "app_off" });
  });
});
