import type { Page } from "@playwright/test";
import { analyticsEvents, expect, test } from "./fixtures.ts";

/**
 * What analytics gives back: admins' dashboard at /analytics (and nobody
 * else's), makers' view of their own slop, and the same through the API
 * and MCP. The database is shared, so each test reads only what it made.
 */

async function distinctIdOf(page: Page): Promise<string> {
  await expect.poll(async () => (await page.context().cookies()).some((cookie) => cookie.name === "sa_id")).toBe(true);
  return (await page.context().cookies()).find((cookie) => cookie.name === "sa_id")?.value ?? "";
}

test.describe("analytics, given back", () => {
  test("is for admins: everyone else gets a 404", async ({ seed }) => {
    const user = await seed.pageAs(await seed.user("curious"));
    for (const path of ["/analytics", "/analytics/traffic", "/analytics/insights", "/analytics/people"]) {
      expect((await user.goto(path))?.status(), path).toBe(404);
    }
    const moderator = await seed.pageAs(await seed.moderator());
    expect((await moderator.goto("/analytics"))?.status()).toBe(404);
    const visitor = await seed.visitorPage();
    await visitor.goto("/analytics");
    await expect(visitor).toHaveURL(/\/login\?returnTo=%2Fanalytics/);
  });

  test("shows a maker who saw their slop, where they came from and what they clicked", async ({ seed, stack }) => {
    const maker = await seed.user("watched");
    const slop = await seed.slop(maker);
    const visitor = await seed.visitorPage();
    // "Try it" opens the slop's own site in a new tab; it never needs to load.
    await visitor.context().route("https://example.com/**", (route) => route.fulfill({ body: "the slop itself" }));
    await visitor.goto(`${slop.path}?utm_source=e2e-newsletter`);
    const visitorId = await distinctIdOf(visitor);
    await visitor.getByRole("link", { name: /Try it/ }).click();
    await expect
      .poll(() => analyticsEvents(stack, visitorId).map((event) => event.name), { timeout: 20_000 })
      .toEqual(expect.arrayContaining(["$pageview", "$autocapture"]));

    const page = await seed.pageAs(maker);
    await page.goto(slop.path);
    await page.getByRole("link", { name: "Views and clicks" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Views and clicks");
    await expect(page.getByText("Your own visits don't count.")).toBeVisible();
    const views = page
      .locator(".panel")
      .filter({ hasText: /^Views/ })
      .first();
    await expect(views).toContainText("1");
    await expect(page.getByRole("region", { name: "What they clicked" })).toContainText("Try it (Website)");
    await expect(page.getByRole("region", { name: "Where they came from" })).toContainText("referral");

    // Someone else's slop's analytics are theirs alone.
    const stranger = await seed.pageAs(await seed.user("nosy"));
    expect((await stranger.goto(`${slop.path}/analytics`))?.status()).toBe(403);
  });

  test("lets agents read a slop's analytics, and admins the platform's", async ({ seed, request, stack }) => {
    const maker = await seed.user("agentstats");
    const slop = await seed.slop(maker);
    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    const visitorId = await distinctIdOf(visitor);
    await expect.poll(() => analyticsEvents(stack, visitorId).length, { timeout: 20_000 }).toBeGreaterThan(0);

    const token = await seed.apiToken(maker);
    const headers = { authorization: `Bearer ${token}` };
    const rest = await request.get(`/api/v1/slops/${slop.slug}/analytics?days=7`, { headers });
    expect(rest.ok()).toBe(true);
    const report = (await rest.json()) as { views: number; days: number; slop: { name: string } };
    expect(report).toMatchObject({ views: 1, days: 7, slop: { name: slop.name } });

    const tools = await request.post("/mcp", {
      headers: { ...headers, accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    const names = ((await tools.json()) as { result: { tools: { name: string }[] } }).result.tools.map(
      (tool) => tool.name,
    );
    expect(names).toContain("slop_analytics");
    // Platform analytics aren't an MCP tool, and aren't there for makers' tokens.
    expect(names.some((name) => name.includes("admin"))).toBe(false);
    expect((await request.get("/api/v1/admin/analytics", { headers })).status()).toBe(404);
    expect(await (await request.get("/llms.txt")).text()).not.toContain("admin/analytics");

    const adminToken = await seed.apiToken(await seed.admin());
    const growth = await request.get("/api/v1/admin/analytics?report=growth&days=7", {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(growth.ok()).toBe(true);
    const body = (await growth.json()) as { totals: { accounts: number; slops: number } };
    expect(body.totals.accounts).toBeGreaterThan(0);
    expect(body.totals.slops).toBeGreaterThan(0);
  });

  test("shows admins growth, slops doing better, insights and people", async ({ seed, stack }) => {
    const maker = await seed.user("climber");
    const slop = await seed.slop(maker);
    const visitor = await seed.visitorPage();
    await visitor.goto(slop.path);
    const visitorId = await distinctIdOf(visitor);
    await expect.poll(() => analyticsEvents(stack, visitorId).length, { timeout: 20_000 }).toBeGreaterThan(0);

    const admin = await seed.pageAs(await seed.admin());
    await admin.goto("/");
    await admin.getByLabel("Account menu").click();
    await admin.getByRole("link", { name: "Analytics" }).click();
    await expect(admin).toHaveURL(/\/analytics$/);
    await expect(admin.getByRole("heading", { name: "Growth, last 30 days" })).toBeVisible();
    await expect(admin.getByText("Slopper accounts")).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Slops doing better" })).toBeVisible();

    await admin.getByRole("navigation", { name: "Analytics" }).getByRole("link", { name: "Traffic" }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText("Traffic");
    await expect(admin.getByRole("region", { name: "Pages" })).toBeVisible();

    const funnel = new URLSearchParams({ kind: "funnel", days: "7" });
    funnel.append("event", "$pageview");
    funnel.append("stepPath", slop.path);
    funnel.append("event", "$pageview");
    funnel.append("stepPath", "/nowhere-anyone-goes");
    await admin.goto(`/analytics/insights?${funnel.toString()}`);
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText("Insights");
    await expect(admin.getByText(`1. Page view of ${slop.path}`)).toBeVisible();
    await expect(admin.getByText("2. Page view of /nowhere-anyone-goes")).toBeVisible();

    await admin.goto("/analytics/people");
    await admin.getByLabel("Username or id").fill(visitorId);
    await admin.getByRole("button", { name: "Find" }).click();
    await expect(admin).toHaveURL(new RegExp(`/analytics/people/${visitorId}$`));
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText(`Visitor ${visitorId.slice(-8)}`);
    await admin.getByText("Forget this person").click();
    await admin.getByRole("button", { name: "Yes, forget them" }).click();
    await expect(admin.getByRole("status")).toHaveText("Forgotten. Everything analytics had on them is being deleted.");
    await expect.poll(() => analyticsEvents(stack, visitorId).length, { timeout: 20_000 }).toBe(0);
    await admin.goto("/mod/team");
    await expect(admin.getByText(`deleted everything analytics had on visitor ${visitorId}`)).toBeVisible();
  });
});
