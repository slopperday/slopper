import { execFileSync } from "node:child_process";
import process from "node:process";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel";
import { expect, test } from "./fixtures.ts";

/**
 * Attack regressions: the exploits the security audits proved against a
 * local stack, kept here so a change that quietly reopens one fails CI.
 * Everything here runs against this test's own data only — the floods that
 * need a shared IP bucket (OAuth starts, anonymous search, card render
 * limits) stay out of the parallel suite and are pinned by
 * tests/security.test.ts instead.
 */

test.describe("security regressions", () => {
  test("invalid create, edit and draft forms only resolve the signed-in maker's media", async ({
    seed,
    convex,
    stack,
  }) => {
    const maker = await seed.user("forms");
    const victim = await seed.user("private");
    const slop = await seed.slop(maker);
    const victimSlop = await seed.slop(victim);
    const upload = async (ownerId: Id<"users">, contentType: string) => {
      const stored = await convex.mutation(api.media.register, {
        ownerId,
        location: { backend: "b2", key: `form-private/${ownerId}/${contentType}` },
        contentType,
        size: 123,
        fileName: `secret-${ownerId}.pdf`,
        check: { verdict: "ok", reason: "Seeded" },
      });

      if (!stored.url) throw new Error("Seeded media has no URL.");

      return { id: stored.mediaId, url: stored.url };
    };
    const image = await upload(maker.id, "image/png");
    const publication = await upload(maker.id, "application/pdf");
    const foreign = await Promise.all([
      upload(victim.id, "image/png"),
      upload(victim.id, "application/pdf"),
      upload(victim.id, "video/mp4"),
    ]);
    const video = foreign[2];
    expect(
      await convex.mutation(api.videos.set, { userId: victim.id, slopId: victimSlop.id, mediaId: video.id }),
    ).toMatchObject({ status: "pending" });
    const page = await seed.pageAs(maker);

    for (const target of [
      { path: "/new", intent: "" },
      { path: `${slop.path}/edit`, intent: "" },
      { path: `${slop.path}/edit`, intent: "draft" },
    ]) {
      for (const media of [image, ...foreign]) {
        const response = await page.request.post(`${stack.appUrl}${target.path}`, {
          headers: { origin: stack.appUrl },
          form: {
            name: "",
            screenshot: media.id,
            publication: media.id === image.id ? publication.id : media.id,
            intent: target.intent,
          },
        });
        const body = await response.text();
        // Drafts may succeed, but every response must apply the same media authorization.
        expect([200, 422]).toContain(response.status());

        for (const privateMedia of foreign) expect(body).not.toContain(privateMedia.url);

        expect(body).not.toContain(`secret-${victim.id}.pdf`);

        if (media.id === image.id) {
          expect(body).toContain(image.url);
          expect(body).toContain(publication.url);
        }
      }
    }
  });

  test("share cards render only their canonical URL", async ({ seed, request, stack }) => {
    const maker = await seed.user("cards");
    const slop = await seed.slop(maker);
    for (const path of [`${slop.path}/card.png`, `/@${maker.username}/card.png`]) {
      const plain = await request.get(path, { maxRedirects: 0 });
      expect(plain.status()).toBe(301);
      const target = new URL(plain.headers()["location"] ?? "", stack.appUrl);
      expect(target.pathname).toBe(path);
      expect(target.search).toMatch(/^\?v=[a-z0-9]+$/);

      for (const search of [
        "?v=",
        "?v=flood",
        "?cache=1",
        `${target.search}&cache=1`,
        `${target.search}&${target.search.slice(1)}`,
      ]) {
        const junk = await request.get(`${path}${search}`, { maxRedirects: 0 });
        expect(junk.status()).toBe(301);
        expect(junk.headers()["location"]).toBe(target.pathname + target.search);
      }

      const canonical = await request.get(target.pathname + target.search, { maxRedirects: 0 });
      expect(canonical.status()).toBe(200);
      expect(canonical.headers()["content-type"]).toBe("image/png");
      expect((await canonical.body()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }
  });

  test("the MCP endpoint and REST API want a token before doing anything", async ({ request }) => {
    // Before even reading the body, which is the cheap way to refuse a flood
    // of big anonymous messages.
    const mcp = await request.post("/mcp", {
      headers: { "content-type": "application/json" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", padding: "x".repeat(100_000) },
    });
    expect(mcp.status()).toBe(401);
    const rest = await request.get("/api/v1/me");
    expect(rest.status()).toBe(401);
    // The admin report is a 404 like any unknown endpoint, for everyone else.
    const admin = await request.get("/api/v1/admin/analytics");
    expect(admin.status()).toBe(404);
    expect(JSON.stringify(await admin.json())).not.toContain("report");
  });

  test("a scheduled-launch claim only answers real Convex ids", async ({ request }) => {
    const junk = await request.post("/api/scheduled/definitely-not-an-id");
    expect(junk.status()).toBe(404);
  });

  // The per-distinct-id event ceiling (2,000 a day) is crossed by
  // tests/analytics.test.ts in-process: proving it here would mean a burst
  // of thousands of events through the shared backend, whose contention
  // rocks every test running beside it. The identify test below proves the
  // ceilings engage through the real HTTP route; the caps themselves are
  // bounded by tests/security.test.ts.

  test("a forged identity can only merge into an account so often", async ({ stack }) => {
    const address = `${stack.convexSiteUrl}/a/e`;
    const post = (events: object[]) =>
      fetch(address, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: stack.appUrl,
          "user-agent": "Mozilla/5.0 slopper-e2e",
        },
        body: JSON.stringify({ sentAt: Date.now(), events }),
      });
    const pageview = (distinctId: string, path = "/") => ({
      uuid: crypto.randomUUID(),
      name: "$pageview",
      distinctId,
      sessionId: `${distinctId}-s`,
      timestamp: Date.now(),
      path,
      properties: {},
      set: null,
      setOnce: null,
    });
    // The events endpoint takes whoever's word for who is sending, but an
    // account takes only ten `$identify` merges a day: enough for a person's
    // own browsers, too few to make merging into someone else's analytics
    // person a tool. Twelve forged ones land, ten stick.
    const account = `victim-${Date.now().toString(36)}`;
    const seeded = await post([pageview(account, "/today")]);
    expect(seeded.status).toBe(200);
    for (let i = 0; i < 12; i++) {
      const anon = `anon-${account}-${i}`;
      const seen = await post([pageview(anon)]);
      expect(seen.status).toBe(200);
      const identify = await post([
        {
          uuid: crypto.randomUUID(),
          name: "$identify",
          distinctId: account,
          sessionId: `${anon}-s`,
          timestamp: Date.now(),
          path: "/",
          properties: { anonDistinctId: anon },
          set: null,
          setOnce: null,
        },
      ]);
      expect(identify.status).toBe(200);
    }
    const person = JSON.parse(
      execFileSync(
        "node_modules/.bin/convex",
        ["run", "--component", "analytics", "persons:get", JSON.stringify({ distinctId: account })],
        {
          stdio: "pipe",
          env: {
            ...process.env,
            CONVEX_DEPLOYMENT: "",
            CONVEX_SELF_HOSTED_URL: stack.convexUrl,
            CONVEX_SELF_HOSTED_ADMIN_KEY: stack.adminKey,
          },
        },
      ).toString("utf8"),
    ) as { distinctIds: string[] };
    // The account itself plus at most ten merged browsers — not twelve.
    expect(person.distinctIds).toHaveLength(11);
    expect(person.distinctIds).toContain(account);
  });
});
