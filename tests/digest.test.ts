// @vitest-environment edge-runtime
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { nextLocalHour } from "~/lib/dates";
import { createElement } from "react";
import { render } from "react-email";
import { DigestEmail, type DigestEmailProps } from "~/emails/digest";
import { type DigestItem, digestHeadline, digestLine, summariseDigest } from "~/lib/digest";
import { convexApp } from "./convexApp";

const HOUR = 3_600_000;

function setup() {
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}

type Server = ReturnType<typeof setup>["server"];

async function signIn(server: Server, name: string, email: string | null = `${name}@example.com`) {
  const { userId } = await server.mutation(api.users.upsertFromIdentity, {
    provider: "dev",
    providerId: name,
    preferredUsername: name,
    displayName: name,
    avatarUrl: null,
    timeZone: "Europe/London",
    email,
  });
  return userId;
}

async function ship(server: Server, userId: Id<"users">): Promise<Id<"slops">> {
  const { slopId } = await server.mutation(api.slops.create, {
    userId,
    input: {
      name: "TiltMaze",
      tagline: "Tilt to play",
      description: "",
      category: "games",
      links: [{ kind: "website", url: "https://tiltmaze.app/" }],
      screenshots: [],
      madeWith: [],
    },
    launchNote: "Day 1",
  });
  return slopId;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("9am on each person's clock", () => {
  it("finds the next 9am today or tomorrow", () => {
    // London is on summer time (UTC+1) in early October.
    expect(new Date(nextLocalHour("Europe/London", 9, Date.parse("2026-10-08T07:30:00Z"))).toISOString()).toBe(
      "2026-10-08T08:00:00.000Z",
    );
    expect(new Date(nextLocalHour("Europe/London", 9, Date.parse("2026-10-08T08:00:00Z"))).toISOString()).toBe(
      "2026-10-09T08:00:00.000Z",
    );
    expect(new Date(nextLocalHour("Asia/Kolkata", 9, Date.parse("2026-10-08T00:00:00Z"))).toISOString()).toBe(
      "2026-10-08T03:30:00.000Z",
    );
    expect(new Date(nextLocalHour("America/Los_Angeles", 9, Date.parse("2026-10-08T20:00:00Z"))).toISOString()).toBe(
      "2026-10-09T16:00:00.000Z",
    );
  });

  it("follows the clocks across a DST change", () => {
    // London's clocks go back on 25 October 2026: 9am is then 09:00 UTC.
    expect(new Date(nextLocalHour("Europe/London", 9, Date.parse("2026-10-24T09:00:00Z"))).toISOString()).toBe(
      "2026-10-25T09:00:00.000Z",
    );
  });
});

describe("the digest email", () => {
  const slop = { id: "s1", name: "TiltMaze", launchLabel: null, slug: "tiltmaze" };
  const other = { id: "s2", name: "<Slop & Co>", launchLabel: "iOS app", slug: "slop-co" };
  const items: DigestItem[] = [
    { kind: "upvote", slop, amount: null },
    { kind: "upvote", slop, amount: null },
    { kind: "pledge", slop, amount: 2500 },
    { kind: "upvote", slop: other, amount: null },
  ];
  const input: DigestEmailProps = {
    username: "maker",
    items,
    appUrl: "https://slopper.day",
    unsubscribeUrl: "https://slopper.day/unsubscribe/token",
  };

  it("sums up each slop", () => {
    const slops = summariseDigest("maker", items);
    expect(digestHeadline(slops)).toBe("Your slops got 3 upvotes and 1 pledge");
    expect(slops.map(digestLine)).toEqual(["2 upvotes and 1 pledge ($25.00)", "1 upvote"]);
    expect(slops[0].path).toBe("/@maker/tiltmaze");
  });

  it("leads with a win", () => {
    const slops = summariseDigest("maker", [...items, { kind: "slop_of_the_day", slop: other, amount: null }]);
    expect(digestHeadline(slops)).toBe("🏆 <Slop & Co> · iOS app won slop of the day");
    expect(slops[0].title).toBe("<Slop & Co> · iOS app");
  });

  it("renders on brand, with absolute links and every name as text", async () => {
    const email = createElement(DigestEmail, input);
    const html = await render(email);
    const text = await render(email, { plainText: true });
    expect(html).toContain("SLOPPER");
    expect(html).toContain("Your slops got 3 upvotes and 1 pledge");
    expect(html).toContain('href="https://slopper.day/@maker/tiltmaze"');
    expect(html).toContain('src="https://slopper.day/icon-192.png"');
    expect(html).toContain('href="https://slopper.day/unsubscribe/token"');
    expect(html).toContain("#9be22d"); // the lime button
    // Names people chose are text, never markup.
    expect(html).not.toContain("<Slop & Co>");
    expect(html).toContain("&lt;Slop &amp; Co&gt;");
    // The plain-text part has the news and the way out.
    expect(text).toContain("TiltMaze");
    expect(text).toContain("https://slopper.day/@maker/tiltmaze");
    expect(text).toContain("https://slopper.day/unsubscribe/token");
  });
});

describe("email addresses", () => {
  it("keeps the first verified address, never replacing it", async () => {
    const { t, server } = setup();
    const userId = await signIn(server, "ada");
    let user = await t.run((ctx) => ctx.db.get(userId));
    expect(user).toMatchObject({ email: "ada@example.com", digestSentAt: expect.any(Number) });
    expect(user?.emailToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(user?.nextDigestAt).toBeGreaterThan(Date.now());

    await signIn(server, "ada", "other@example.com");
    user = await t.run((ctx) => ctx.db.get(userId));
    expect(user?.email).toBe("ada@example.com");
  });

  it("picks one up later from a sign-in or a linked account", async () => {
    const { t, server } = setup();
    const userId = await signIn(server, "bo", null);
    expect((await t.run((ctx) => ctx.db.get(userId)))?.email).toBeUndefined();
    await server.mutation(api.users.linkIdentity, {
      userId,
      provider: "google",
      providerId: "g-bo",
      email: "bo@example.com",
    });
    expect((await t.run((ctx) => ctx.db.get(userId)))?.email).toBe("bo@example.com");
  });

  it("never reaches public pages", async () => {
    const { server } = setup();
    await signIn(server, "private");
    const profile = await server.query(api.users.profile, { username: "private" });
    expect(JSON.stringify(profile)).not.toContain("example.com");
  });
});

describe("daily digests", () => {
  const NOW = Date.parse("2026-10-09T08:00:00Z"); // 9am in London

  async function dueMaker(t: ReturnType<typeof setup>["t"], server: Server) {
    const maker = await signIn(server, "maker");
    const fan = await signIn(server, "fan");
    const slopId = await ship(server, maker);
    // Their last digest went out yesterday; today's is due now.
    await t.run((ctx) => ctx.db.patch(maker, { digestSentAt: NOW - 24 * HOUR, nextDigestAt: NOW }));
    return { maker, fan, slopId };
  }

  it("emails what's new and unread through Resend, then waits for tomorrow", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW - HOUR);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("APP_URL", "https://slopper.day");
    const posts: {
      url: string;
      headers: Headers;
      body: { to: string[]; subject: string; text: string; html: string; headers: Record<string, string> }[];
    }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      posts.push({
        url: input instanceof Request ? input.url : input.toString(),
        headers: new Headers(init?.headers),
        body: JSON.parse(typeof init?.body === "string" ? init.body : "[]") as (typeof posts)[number]["body"],
      });
      return Response.json({ data: [{ id: "email-1" }] });
    });

    const { t, server } = setup();
    const { maker, fan, slopId } = await dueMaker(t, server);
    await server.mutation(api.slops.vote, { userId: fan, slopId, value: 1 });
    await server.mutation(api.slops.pledge, { userId: fan, slopId, amount: 1500 });

    await t.mutation(internal.digest.run, { now: NOW });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("https://api.resend.com/emails/batch");
    expect(posts[0].headers.get("authorization")).toBe("Bearer re_test");
    expect(posts[0].headers.get("idempotency-key")).toBe(`digest-${NOW}`);
    const [email] = posts[0].body;
    const user = await t.run((ctx) => ctx.db.get(maker));
    expect(email.to).toEqual(["maker@example.com"]);
    expect(email.subject).toBe("Your slops got 1 upvote and 1 pledge");
    expect(email.text).toContain("TiltMaze");
    expect(email.html).toContain("$15.00");
    expect(email.headers["List-Unsubscribe"]).toBe(`<https://slopper.day/unsubscribe/${user?.emailToken}>`);
    expect(email.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(user?.digestSentAt).toBe(NOW);
    expect(user?.nextDigestAt).toBe(NOW + 24 * HOUR);

    // Nothing new since: tomorrow's run sends nothing.
    await t.mutation(internal.digest.run, { now: NOW + 24 * HOUR });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(posts).toHaveLength(1);
  });

  it("leaves out what was already read or already sent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW - HOUR);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { t, server } = setup();
    const { maker, fan, slopId } = await dueMaker(t, server);
    await server.mutation(api.slops.vote, { userId: fan, slopId, value: 1 });
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("notifications").collect())
        await ctx.db.patch(row._id, { readAt: NOW - HOUR });
    });

    await t.mutation(internal.digest.run, { now: NOW });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((job) => job.name.startsWith("digestSend"))).toEqual([]);
    expect((await t.run((ctx) => ctx.db.get(maker)))?.nextDigestAt).toBe(NOW + 24 * HOUR);
  });

  it("skips people who turned it off, and anyone at all until Resend is set up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW - HOUR);
    const { t, server } = setup();
    const { maker, fan, slopId } = await dueMaker(t, server);
    await server.mutation(api.slops.vote, { userId: fan, slopId, value: 1 });

    await t.mutation(internal.digest.run, { now: NOW });
    expect((await t.run((ctx) => ctx.db.get(maker)))?.nextDigestAt).toBe(NOW);

    vi.stubEnv("RESEND_API_KEY", "re_test");
    await server.mutation(api.users.setEmailDigest, { userId: maker, enabled: false });
    expect((await t.run((ctx) => ctx.db.get(maker)))?.nextDigestAt).toBeUndefined();
    await t.mutation(internal.digest.run, { now: NOW });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((job) => job.name.startsWith("digestSend"))).toEqual([]);

    await server.mutation(api.users.setEmailDigest, { userId: maker, enabled: true });
    expect((await t.run((ctx) => ctx.db.get(maker)))?.nextDigestAt).toBe(nextLocalHour("Europe/London", 9, Date.now()));
  });

  it("unsubscribes with the token from the email, and only with it", async () => {
    const { t, server } = setup();
    const maker = await signIn(server, "maker");
    const token = (await t.run((ctx) => ctx.db.get(maker)))?.emailToken ?? "";
    expect(await server.mutation(api.users.unsubscribe, { token: "00000000-0000-0000-0000-000000000000" })).toBeNull();
    expect(await server.mutation(api.users.unsubscribe, { token })).toEqual({ username: "maker" });
    const user = await t.run((ctx) => ctx.db.get(maker));
    expect(user?.emailDigest).toBe(false);
    expect(user?.nextDigestAt).toBeUndefined();
  });

  it("moves 9am with the time zone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-08T12:00:00Z"));
    const { t, server } = setup();
    const maker = await signIn(server, "maker");
    await server.mutation(api.users.updateProfile, {
      userId: maker,
      username: "maker",
      displayName: "maker",
      bio: "",
      website: null,
      timeZone: "Asia/Tokyo",
      showNsfw: false,
    });
    expect((await t.run((ctx) => ctx.db.get(maker)))?.nextDigestAt).toBe(Date.parse("2026-10-09T00:00:00Z"));
  });
});
