// @vitest-environment edge-runtime
import { describe, expect, it, vi } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { utmLink } from "@convex/social";
import { csvPosts, parseCsv, wallTime } from "~/lib/csv";
import { feedPost, parseFeed } from "~/lib/feeds";
import { calendarFeed } from "~/lib/ics";
import { textLimitFor, unsupportedReason, X_LONG_LIMIT } from "~/lib/networks";
import { numberThread, splitThread } from "~/lib/thread";
import { applyVariables, hasSpintax, personalize, spin } from "~/lib/variables";
import { parseAssist } from "~/.server/social/assist";
import type { SocialAdapter } from "~/.server/social/core";
import { SocialError } from "~/.server/social/core";
import { bestTimes, brokenReason, followUps, nextQueueSlot, wordsFor, zonedParts } from "~/.server/social/studio";
import { convexApp } from "./convexApp";

function setup() {
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}
type Server = ReturnType<typeof setup>["server"];

async function makeUser(server: Server, name: string): Promise<Id<"users">> {
  const { userId } = await server.mutation(api.users.upsertFromIdentity, {
    provider: "dev",
    providerId: name,
    preferredUsername: name,
    displayName: name,
    avatarUrl: null,
    timeZone: "UTC",
  });
  return userId;
}

async function connect(server: Server, userId: Id<"users">, provider: "x" | "bluesky" | "facebook", handle: string) {
  return await server.mutation(api.accounts.connect, {
    userId,
    provider,
    remoteId: `${provider}-${handle}`,
    handle,
    displayName: handle,
    avatarUrl: null,
    sealedCredentials: "sealed",
    expiresAt: null,
  });
}

const post = {
  productId: null,
  text: "Shipped it",
  link: null,
  media: [],
  overrides: {},
  options: {},
  scheduledAt: null,
};

describe("variables and spintax", () => {
  it("fills in the moment, the product and the network", () => {
    const text = applyVariables("{product} is out on {day} {date} at {time} · {network} · {link} · {nope}", {
      at: Date.UTC(2026, 10, 3, 9, 30),
      timeZone: "Europe/London",
      product: "Tiltmaze",
      link: "https://tiltmaze.app",
      network: "Bluesky",
    });
    expect(text).toBe("Tiltmaze is out on Tuesday 3 November 2026 at 09:30 · Bluesky · https://tiltmaze.app · {nope}");
  });

  it("picks one choice per account, the same way every time", () => {
    expect(hasSpintax("{Hi|Hello} there")).toBe(true);
    expect(hasSpintax("{date}")).toBe(false);
    const a = spin("{Hi|Hello|Hey} {there|friends}", "account-a");
    expect(spin("{Hi|Hello|Hey} {there|friends}", "account-a")).toBe(a);
    expect(a).toMatch(/^(Hi|Hello|Hey) (there|friends)$/);
    const seen = new Set(Array.from({ length: 20 }, (_, i) => spin("{a|b|c}", `seed-${i}`)));
    expect(seen.size).toBeGreaterThan(1);
    expect(
      personalize("{Hi|Hi} on {network}", "x", { at: 0, timeZone: "UTC", product: null, link: null, network: "X" }),
    ).toBe("Hi on X");
  });
});

describe("threads", () => {
  it("splits at --- first, then by sentences to fit", () => {
    const parts = splitThread("One.\n---\nTwo is longer. It has two sentences.", 22, (s) => s.length);
    expect(parts).toEqual(["One.", "Two is longer.", "It has two sentences."]);
    expect(splitThread("word ".repeat(100), 50, (s) => s.length).every((part) => part.length <= 50)).toBe(true);
    expect(numberThread(["a", "b"])).toEqual(["a 1/2", "b 2/2"]);
  });

  it("posts the thread then the first comment as replies, and stops with a warning when one fails", async () => {
    const replies: string[] = [];
    const adapter: SocialAdapter = {
      publish: () => Promise.reject(new Error("unused")),
      send: () => Promise.reject(new Error("unused")),
      reply: (_account, parent, text) => {
        replies.push(`${parent.remoteId}<-${text}`);
        if (text === "boom") return Promise.reject(new SocialError("Bluesky turned it down: busy"));
        return Promise.resolve({ remoteId: `r${replies.length}`, cid: `c${replies.length}` });
      },
    };
    const account = { _id: "acc", provider: "bluesky", longPosts: undefined } as unknown as Doc<"accounts">;
    const context = { timeZone: "UTC", product: null };
    const done = await followUps(
      adapter,
      account,
      { remoteId: "root", cid: "c0" },
      { thread: ["two", "three"], firstComment: "#tags" },
      context,
    );
    expect(replies).toEqual(["root<-two", "r1<-three", "r2<-#tags"]);
    expect(done).toEqual({ parts: ["r1", "r2", "r3"], warning: null });

    replies.length = 0;
    const stopped = await followUps(
      adapter,
      account,
      { remoteId: "root" },
      { thread: ["two", "boom", "four"] },
      context,
    );
    expect(stopped.parts).toEqual(["r1"]);
    expect(stopped.warning).toBe("The thread stopped at post 3: Bluesky turned it down: busy");

    // Resuming picks up from the last sent reply instead of posting the start of the thread again.
    replies.length = 0;
    const resumed = await followUps(
      adapter,
      account,
      { remoteId: "root" },
      { thread: ["two", "three", "four"] },
      context,
      stopped.parts,
    );
    expect(replies).toEqual(["r1<-three", "r1<-four"]);
    expect(resumed).toEqual({ parts: ["r1", "r1", "r2"], warning: null });

    // Facebook doesn't thread: only the first comment goes.
    replies.length = 0;
    const page = { ...account, provider: "facebook" } as Doc<"accounts">;
    await followUps(adapter, page, { remoteId: "p" }, { thread: ["two"], firstComment: "hi" }, context);
    expect(replies).toEqual(["p<-hi"]);
  });
});

describe("fitting words to an account", () => {
  it("gives X Premium accounts long posts, and lets one account override its network's words", () => {
    const long = "word ".repeat(200);
    expect(textLimitFor("x", { longPosts: true })).toBe(X_LONG_LIMIT);
    expect(
      wordsFor(
        "x",
        { text: long, link: null, overrides: {} },
        { account: { _id: "a" as Id<"accounts">, longPosts: true } },
      ),
    ).toBe(long.trim());
    expect(wordsFor("x", { text: long, link: null, overrides: {} }).length).toBeLessThanOrEqual(280);
    expect(
      wordsFor(
        "x",
        { text: "shared", link: null, overrides: { x: "for x", a: "for account a" } },
        { account: { _id: "a" as Id<"accounts"> } },
      ),
    ).toBe("for account a");
  });

  it("tells documents apart: LinkedIn only, and on their own", () => {
    expect(unsupportedReason("linkedin", { images: 0, video: null, documents: 1 })).toBeNull();
    expect(unsupportedReason("x", { images: 0, video: null, documents: 1 })).toMatch(/Only LinkedIn/);
    expect(unsupportedReason("linkedin", { images: 1, video: null, documents: 1 })).toBe("A document goes on its own.");
  });

  it("says when a refusal means reconnecting", () => {
    expect(brokenReason(new SocialError("X turned it down: Unauthorized", 401))).toMatch(/Reconnect/);
    expect(brokenReason(new SocialError("LinkedIn connections last 60 days. Reconnect the account."))).toMatch(
      /60 days/,
    );
    expect(brokenReason(new SocialError("X turned it down: duplicate", 403))).toBeNull();
  });
});

describe("the queue and best times", () => {
  it("takes the next free slot in the person's time zone", () => {
    const monday9 = Date.UTC(2026, 10, 2, 9, 0); // Monday 2 November 2026, 09:00 UTC
    const slots = [
      { day: 1, minute: 9 * 60 },
      { day: 1, minute: 12 * 60 },
    ];
    expect(nextQueueSlot(slots, [], "UTC", monday9 - 3_600_000)).toBe(monday9);
    expect(nextQueueSlot(slots, [monday9], "UTC", monday9 - 3_600_000)).toBe(Date.UTC(2026, 10, 2, 12, 0));
    // 09:00 in New York is 14:00 UTC in November.
    expect(nextQueueSlot([{ day: 1, minute: 540 }], [], "America/New_York", monday9)).toBe(
      Date.UTC(2026, 10, 2, 14, 0),
    );
    expect(nextQueueSlot([], [], "UTC")).toBeNull();
    expect(zonedParts(monday9, "UTC")).toEqual({ day: 1, minute: 540 });
  });

  it("learns from the person's own posts once there are enough", () => {
    expect(bestTimes([], "UTC")[0].reason).toBe("typical");
    const tuesday18 = Date.UTC(2026, 10, 3, 18, 10);
    const sent = Array.from({ length: 10 }, (_, i) => ({
      sentAt: i < 5 ? tuesday18 + i * 7 * 86_400_000 : Date.UTC(2026, 10, 4, 7, 0) + i * 7 * 86_400_000,
      metrics: { likes: i < 5 ? 100 : 1 },
    }));
    expect(bestTimes(sent, "UTC")[0]).toEqual({ day: 2, minute: 18 * 60, reason: "yours" });
  });
});

describe("spreadsheets, feeds and calendars", () => {
  it("reads CSV with quotes, and wall times in the person's zone", () => {
    expect(parseCsv('text,when\n"Hello, ""you""",2026-11-24 09:30\n')).toEqual([
      ["text", "when"],
      ['Hello, "you"', "2026-11-24 09:30"],
    ]);
    const { posts } = csvPosts("Text,When,Tags,First comment\nShipped,2026-11-24 09:30,a b,#x\n,,,\n");
    expect(posts).toEqual([
      { row: 2, text: "Shipped", when: "2026-11-24 09:30", link: "", tags: ["a", "b"], firstComment: "#x" },
    ]);
    expect(csvPosts("when\n2026").error).toMatch(/text column/);
    expect(wallTime("2026-11-24 09:30", "America/New_York")).toBe(Date.UTC(2026, 10, 24, 14, 30));
    expect(wallTime("2026-11-24T09:30:00Z", "Asia/Tokyo")).toBe(Date.UTC(2026, 10, 24, 9, 30));
    expect(wallTime("tomorrow", "UTC")).toBeNull();
  });

  it("reads RSS and Atom items", () => {
    const rss = parseFeed(
      `<rss><channel><item><title><![CDATA[Tiltmaze &amp; friends]]></title><link>https://a.test/1</link><guid>g1</guid></item></channel></rss>`,
    );
    expect(rss).toEqual([{ id: "g1", title: "Tiltmaze & friends", link: "https://a.test/1" }]);
    const atom = parseFeed(
      `<feed><entry><title>Two</title><link rel="alternate" href="https://a.test/2"/><id>tag:2</id></entry></feed>`,
    );
    expect(atom).toEqual([{ id: "tag:2", title: "Two", link: "https://a.test/2" }]);
    expect(feedPost("New: {title} {link}", rss[0])).toBe("New: Tiltmaze & friends https://a.test/1");
  });

  it("writes a calendar feed calendar apps read", () => {
    const ics = calendarFeed([
      {
        id: "p1",
        at: Date.UTC(2026, 10, 24, 9, 30),
        text: "Hello, world; again",
        networks: ["X"],
        url: "https://slopper.day/studio/posts/p1",
      },
    ]);
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("DTSTART:20261124T093000Z");
    expect(ics).toContain("SUMMARY:Hello\\, world\\; again");
  });

  it("adds UTM tags without overwriting the maker's own", () => {
    expect(utmLink("https://a.test/?utm_source=mine", "x", "launch")).toBe(
      "https://a.test/?utm_source=mine&utm_medium=social&utm_campaign=launch",
    );
  });

  it("reads the assistant's answers strictly", () => {
    expect(parseAssist("shorten", '{"text": " Short "}')).toEqual({ text: "Short" });
    expect(parseAssist("thread", '{"posts": ["a", "b"]}')).toEqual({ posts: ["a", "b"] });
    expect(parseAssist("hashtags", '{"hashtags": ["indie dev", "#games"]}')).toEqual({
      hashtags: ["#indiedev", "#games"],
    });
    expect(() => parseAssist("shorten", '{"verdict": "ok"}')).toThrow();
  });
});

describe("studio posts in Convex: the new parts", () => {
  it("saves drafts without scheduling, edits them, then posts", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    const a = await connect(server, userId, "x", "one");
    const postId = await server.mutation(api.social.create, { ...post, userId, accountIds: [a._id], draft: true });
    expect(await server.mutation(api.social.claim, { postId })).toBeNull();
    const draft = await server.query(api.social.get, { userId, postId });
    expect(draft?.draft).toBe(true);
    expect(draft?.editable).toBe(true);
    await server.mutation(api.social.update, {
      ...post,
      userId,
      postId,
      text: "Better words",
      accountIds: [a._id],
      tags: ["Launch"],
    });
    const sent = await server.query(api.social.get, { userId, postId });
    expect(sent?.text).toBe("Better words");
    expect(sent?.tags).toEqual(["launch"]);
    expect(sent?.activity.map((entry) => entry.kind)).toEqual(["created", "edited"]);
    expect((await server.mutation(api.social.claim, { postId }))?.deliveries).toHaveLength(1);
  });

  it("returns the same post for the same idempotency key, and refuses the same words twice in a day", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    const a = await connect(server, userId, "x", "one");
    const first = await server.mutation(api.social.create, {
      ...post,
      userId,
      accountIds: [a._id],
      idempotencyKey: "k1",
    });
    expect(
      await server.mutation(api.social.create, { ...post, userId, accountIds: [a._id], idempotencyKey: "k1" }),
    ).toBe(first);
    const claimed = await server.mutation(api.social.claim, { postId: first });
    await server.mutation(api.social.record, {
      deliveryId: claimed!.deliveries[0]._id,
      result: { status: "ok", remoteId: "1", url: "https://x.com/one/status/1" },
    });
    await expect(server.mutation(api.social.create, { ...post, userId, accountIds: [a._id] })).rejects.toThrow(
      "exact words",
    );
    // Spintax makes each copy differ, so it may go again.
    await server.mutation(api.social.create, { ...post, userId, text: "{Shipped|Out now}", accountIds: [a._id] });
  });

  it("staggers accounts, holds reposts until there's something to repost, and pauses everything", async () => {
    vi.useFakeTimers();
    try {
      const { server } = setup();
      const userId = await makeUser(server, "maker");
      const a = await connect(server, userId, "x", "one");
      const b = await connect(server, userId, "bluesky", "two");
      const r = await connect(server, userId, "x", "fan");
      const postId = await server.mutation(api.social.create, {
        ...post,
        userId,
        accountIds: [a._id, b._id],
        repostAccountIds: [r._id],
        staggerMinutes: 30,
      });
      const first = await server.mutation(api.social.claim, { postId });
      // The first account now; the second waits its turn; the repost waits for the post.
      expect(first?.deliveries.map((row) => row.handle)).toEqual(["one"]);
      await server.mutation(api.social.record, {
        deliveryId: first!.deliveries[0]._id,
        result: { status: "ok", remoteId: "9", url: "https://x.com/one/status/9" },
      });
      const second = await server.mutation(api.social.claim, { postId });
      expect(second?.deliveries.map((row) => [row.handle, row.repost ?? false])).toEqual([["fan", true]]);
      expect(second?.originals).toEqual([
        { provider: "x", remoteId: "9", cid: undefined, url: "https://x.com/one/status/9" },
      ]);

      await server.mutation(api.studio.saveSettings, { userId, paused: true });
      vi.advanceTimersByTime(31 * 60_000);
      expect(await server.mutation(api.social.claim, { postId })).toBeNull();
      await server.mutation(api.studio.saveSettings, { userId, paused: false });
      expect((await server.mutation(api.social.claim, { postId }))?.deliveries.map((row) => row.handle)).toEqual([
        "two",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("makes the next copy of a repeating post when it goes out", async () => {
    vi.useFakeTimers();
    try {
      const { server } = setup();
      const userId = await makeUser(server, "maker");
      const a = await connect(server, userId, "x", "one");
      const at = Date.now() + 60 * 60_000;
      const postId = await server.mutation(api.social.create, {
        ...post,
        userId,
        accountIds: [a._id],
        scheduledAt: at,
        repeat: { everyDays: 7, remaining: 2 },
      });
      vi.advanceTimersByTime(61 * 60_000);
      await server.mutation(api.social.claim, { postId });
      const posts = await server.query(api.social.list, { userId });
      expect(posts).toHaveLength(2);
      const next = posts.find((item) => item.id !== postId)!;
      expect(next.scheduledAt).toBe(at + 7 * 86_400_000);
      expect(next.repeat).toEqual({ everyDays: 7, remaining: 1 });
      // Claiming again never makes another.
      await server.mutation(api.social.claim, { postId });
      expect(await server.query(api.social.list, { userId })).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts clicks on tracked links, one per network with UTM tags", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    const a = await connect(server, userId, "x", "one");
    const b = await connect(server, userId, "facebook", "Page");
    const postId = await server.mutation(api.social.create, {
      ...post,
      userId,
      link: "https://tiltmaze.app/",
      accountIds: [a._id, b._id],
      trackLinks: true,
      tags: ["launch"],
    });
    const shaped = await server.query(api.social.get, { userId, postId });
    expect(shaped?.links.map((row) => row.provider).sort()).toEqual(["facebook", "x"]);
    const code = shaped!.links.find((row) => row.provider === "x")!.code;
    expect(await server.mutation(api.studio.follow, { code, count: true })).toBe(
      "https://tiltmaze.app/?utm_source=x&utm_medium=social&utm_campaign=launch",
    );
    await server.mutation(api.studio.follow, { code, count: false });
    expect(
      (await server.query(api.social.get, { userId, postId }))?.links.find((row) => row.code === code)?.clicks,
    ).toBe(1);
    expect(await server.mutation(api.studio.follow, { code: "nope", count: true })).toBeNull();
  });

  it("makes no short links for drafts, which haven't been checked", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    const a = await connect(server, userId, "x", "one");
    const fields = { ...post, userId, link: "https://tiltmaze.app/", accountIds: [a._id], trackLinks: true };
    const postId = await server.mutation(api.social.create, { ...fields, draft: true });
    expect((await server.query(api.social.get, { userId, postId }))?.links).toEqual([]);
    await server.mutation(api.social.update, { ...fields, postId, scheduledAt: Date.now() + 3_600_000 });
    expect((await server.query(api.social.get, { userId, postId }))?.links).toHaveLength(1);
  });

  it("lets anyone with a preview link leave feedback until it's revoked", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    const a = await connect(server, userId, "x", "one");
    const postId = await server.mutation(api.social.create, { ...post, userId, accountIds: [a._id], draft: true });
    const token = await server.mutation(api.studio.createReview, { userId, postId });
    expect((await server.query(api.studio.reviewByToken, { token }))?.postId).toBe(postId);
    await server.mutation(api.studio.addFeedback, { token, name: "Client", verdict: "approve", note: "Ship it" });
    const review = await server.query(api.studio.reviewFor, { userId, postId });
    expect(review?.feedback.map((item) => [item.name, item.verdict])).toEqual([["Client", "approve"]]);
    expect((await server.query(api.social.get, { userId, postId }))?.activity.at(-1)?.kind).toBe("approved");
    await server.mutation(api.studio.revokeReview, { userId, postId });
    expect(await server.query(api.studio.reviewByToken, { token })).toBeNull();
    await expect(
      server.mutation(api.studio.addFeedback, { token, name: "x", verdict: "changes", note: "" }),
    ).rejects.toThrow("expired");
  });

  it("keeps workflows of the person's own accounts, and the one new posts start with", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    const other = await makeUser(server, "someone-else");
    const x = await connect(server, userId, "x", "mine-x");
    const bluesky = await connect(server, userId, "bluesky", "mine-bsky");
    const theirs = await connect(server, other, "x", "theirs");
    const id = await server.mutation(api.studio.saveWorkflow, {
      userId,
      name: "  Everyday  ",
      accountIds: [x._id, bluesky._id, theirs._id, x._id, "not-an-id"],
      when: "queue",
      productId: null,
      trackLinks: true,
      makeDefault: true,
    });
    let settings = await server.query(api.studio.settings, { userId });
    expect(settings.workflows).toEqual([
      { id, name: "Everyday", accountIds: [x._id, bluesky._id], when: "queue", productId: null, trackLinks: true },
    ]);
    expect(settings.defaultWorkflowId).toBe(id);
    await expect(
      server.mutation(api.studio.saveWorkflow, {
        userId,
        name: "Theirs",
        accountIds: [theirs._id],
        when: "now",
        productId: null,
        trackLinks: false,
        makeDefault: false,
      }),
    ).rejects.toThrow("Pick the accounts");

    // Saving it again without the default stops new posts starting with it; choosing brings it back.
    await server.mutation(api.studio.saveWorkflow, {
      userId,
      id,
      name: "Everyday",
      accountIds: [x._id],
      when: "now",
      productId: null,
      trackLinks: false,
      makeDefault: false,
    });
    settings = await server.query(api.studio.settings, { userId });
    expect(settings.workflows).toHaveLength(1);
    expect(settings.workflows[0].accountIds).toEqual([x._id]);
    expect(settings.defaultWorkflowId).toBeNull();
    await server.mutation(api.studio.chooseDefaultWorkflow, { userId, id });
    expect((await server.query(api.studio.settings, { userId })).defaultWorkflowId).toBe(id);
    await server.mutation(api.studio.chooseDefaultWorkflow, { userId, id: "unknown" });
    expect((await server.query(api.studio.settings, { userId })).defaultWorkflowId).toBeNull();

    await server.mutation(api.studio.chooseDefaultWorkflow, { userId, id });
    await server.mutation(api.studio.removeWorkflow, { userId, id });
    settings = await server.query(api.studio.settings, { userId });
    expect(settings.workflows).toEqual([]);
    expect(settings.defaultWorkflowId).toBeNull();
  });

  it("serves a calendar feed only at its secret address", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    const a = await connect(server, userId, "x", "one");
    await server.mutation(api.social.create, {
      ...post,
      userId,
      accountIds: [a._id],
      scheduledAt: Date.now() + 86_400_000,
    });
    await server.mutation(api.studio.saveSettings, { userId, calendar: "create" });
    const { calendarToken } = await server.query(api.studio.settings, { userId });
    expect(await server.query(api.studio.calendarFeed, { token: calendarToken! })).toHaveLength(1);
    expect(await server.query(api.studio.calendarFeed, { token: "0".repeat(48) })).toBeNull();
    await server.mutation(api.studio.saveSettings, { userId, calendar: "revoke" });
    expect(await server.query(api.studio.calendarFeed, { token: calendarToken! })).toBeNull();
  });

  it("keeps one auto-adding signature, and reschedules only what hasn't gone out", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "maker");
    await server.mutation(api.studio.saveSnippet, { userId, kind: "signature", name: "A", text: "— A", autoAdd: true });
    await server.mutation(api.studio.saveSnippet, { userId, kind: "signature", name: "B", text: "— B", autoAdd: true });
    expect(
      (await server.query(api.studio.snippets, { userId })).filter((item) => item.autoAdd).map((item) => item.name),
    ).toEqual(["B"]);

    const a = await connect(server, userId, "x", "one");
    const postId = await server.mutation(api.social.create, {
      ...post,
      userId,
      accountIds: [a._id],
      scheduledAt: Date.now() + 3_600_000,
    });
    const later = Date.now() + 2 * 86_400_000;
    await server.mutation(api.social.reschedule, { userId, postId, scheduledAt: later });
    expect((await server.query(api.social.get, { userId, postId }))?.scheduledAt).toBe(later);
    await expect(
      server.mutation(api.social.reschedule, { userId, postId, scheduledAt: Date.now() - 1000 }),
    ).rejects.toThrow("future");

    await server.mutation(api.accounts.setBrand, { userId, accountId: a._id, brand: "Tiltmaze" });
    await server.mutation(api.studio.saveBrandVoice, { userId, name: "Tiltmaze", voice: "Playful and short." });
    await server.mutation(api.accounts.setBrand, { userId, accountId: a._id, brand: "Tiltmaze Studio" });
    expect(await server.query(api.studio.brands, { userId })).toEqual([
      { name: "Tiltmaze Studio", voice: "Playful and short." },
    ]);
  });
});
