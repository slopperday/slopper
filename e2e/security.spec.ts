import { execFileSync } from "node:child_process";
import process from "node:process";
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
  test("share cards render only their canonical URL, and once per address at most", async ({
    seed,
    request,
    stack,
  }) => {
    const maker = await seed.user("cards");
    const slop = await seed.slop(maker);
    const path = `${slop.path}/card.png`;
    // No version: the image.
    const plain = await request.get(path);
    expect(plain.status()).toBe(200);
    expect(plain.headers()["content-type"]).toBe("image/png");
    // A made-up version — the cache-busting flood — is redirected to the one
    // true URL instead of rendered into the CDN as a fresh entry.
    const junk = await request.get(`${path}?v=flood${Date.now()}`, { maxRedirects: 0 });
    expect(junk.status()).toBe(301);
    const target = new URL(junk.headers()["location"] ?? "", stack.appUrl);
    expect(target.pathname).toBe(path);
    expect(target.searchParams.get("v")).toMatch(/^[a-z0-9]+$/);
    const redrawn = await request.get(target.pathname + target.search);
    expect(redrawn.status()).toBe(200);
    expect(redrawn.headers()["content-type"]).toBe("image/png");
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
