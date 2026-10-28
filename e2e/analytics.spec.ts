import { analyticsEvents, analyticsIdOf, expect, test } from "./fixtures.ts";
import { randomUUID } from "node:crypto";

/**
 * First-party analytics (packages/analytics): the browser posts straight to
 * the Convex backend's HTTP actions, and the analytics component keeps it.
 * Each test reads back only the person its own browser became.
 */

test.describe("analytics", () => {
  test("requires a valid account token and keeps product actions server-only", async ({ seed, stack }) => {
    const user = await seed.user("ingest-proof");
    const page = await seed.pageAs(user);
    const tokenResponse = await page.request.get("/api/convex-token");
    const body: unknown = await tokenResponse.json();
    if (typeof body !== "object" || body === null || !("token" in body) || typeof body.token !== "string") {
      throw new Error("The signed-in browser did not receive a token.");
    }
    const token = body.token;
    const sessionId = randomUUID();
    const post = (name: string, authorization?: string) =>
      page.request.post(`${stack.convexSiteUrl}/a/e`, {
        headers: { origin: stack.issuer, "content-type": "text/plain", ...(authorization ? { authorization } : {}) },
        data: JSON.stringify({
          sentAt: Date.now(),
          events: [
            {
              uuid: randomUUID(),
              name,
              distinctId: user.id,
              sessionId,
              timestamp: Date.now(),
              path: "/wall",
              properties: {},
            },
          ],
        }),
      });
    expect(await (await post("$pageview")).json()).toMatchObject({ stored: 0, dropped: 1 });
    const invalid = await post("$pageview", "Bearer invalid-token");
    expect(invalid.status()).toBe(401);
    expect(await (await post("upvoted", `Bearer ${token}`)).json()).toMatchObject({ stored: 0, dropped: 1 });
    expect(await (await post("$pageview", `Bearer ${token}`)).json()).toMatchObject({ stored: 1, dropped: 0 });
    expect(
      analyticsEvents(stack, user.id)
        .filter((event) => event.sessionId === sessionId)
        .map((event) => event.name),
    ).toEqual(["$pageview"]);
    const now = Date.now();
    const params = new URLSearchParams({
      s: sessionId,
      d: user.id,
      from: String(now),
      to: String(now),
      n: "1",
      z: "0",
      t: String(now),
    });
    const recording = await page.request.post(`${stack.convexSiteUrl}/a/r?${params}`, {
      headers: { origin: stack.issuer, "content-type": "text/plain" },
      data: "[]",
    });
    expect(recording.status()).toBe(403);
  });

  test("records a visit: where it came from, the pages seen and what was clicked", async ({ seed, stack }) => {
    const page = await seed.visitorPage();
    const sent = page.waitForRequest((request) => request.url() === `${stack.convexSiteUrl}/a/e`);
    await page.goto("/wall?utm_source=e2e&utm_campaign=launch-week");
    const distinctId = await analyticsIdOf(page);
    await page.getByRole("banner").getByRole("link", { name: "Today" }).click();
    await expect(page).toHaveURL(/\/today$/);
    expect((await sent).method()).toBe("POST");

    await expect
      .poll(() => analyticsEvents(stack, distinctId).map((event) => `${event.name} ${event.path}`), { timeout: 20_000 })
      .toEqual(
        expect.arrayContaining(["$pageview /wall", "$autocapture /wall", "$pageleave /wall", "$pageview /today"]),
      );
    const events = analyticsEvents(stack, distinctId);
    const landing = events.find((event) => event.name === "$pageview" && event.path === "/wall");
    expect(landing?.properties).toMatchObject({ utmSource: "e2e", utmCampaign: "launch-week" });
    const click = events.find((event) => event.name === "$autocapture");
    expect(click?.properties).toMatchObject({ eventType: "click", tag: "a", text: "Today", href: "/today" });
    // One visit, one session.
    expect(new Set(events.map((event) => event.sessionId)).size).toBe(1);
  });

  test("joins what someone did before signing in to their account", async ({ seed, stack }) => {
    const user = await seed.user("tracked");
    const page = await seed.pageAs(user);
    await page.goto("/streaks");
    await expect
      .poll(() => analyticsEvents(stack, user.id).map((event) => event.name), { timeout: 20_000 })
      .toEqual(expect.arrayContaining(["$identify", "$pageview"]));
    const identify = analyticsEvents(stack, user.id).find((event) => event.name === "$identify");
    expect(identify?.distinctId).toBe(user.id);
    // The browser's anonymous id now leads to the same person.
    const anonymous = String(identify?.properties.anonDistinctId);
    expect(analyticsEvents(stack, anonymous).map((event) => event.name)).toContain("$identify");
  });

  test("can be turned off in a browser, and back on", async ({ seed, stack }) => {
    const page = await seed.visitorPage();
    await page.goto("/privacy");
    const distinctId = await analyticsIdOf(page);
    const section = page.getByRole("region", { name: "Usage analytics" });
    await section.getByRole("button", { name: "Turn off" }).click();
    await expect(section.getByText("Off in this browser")).toBeVisible();
    expect((await page.context().cookies()).find((cookie) => cookie.name === "sa_off")?.value).toBe("1");

    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().startsWith(stack.convexSiteUrl)) requests.push(request.url());
    });
    await page.goto("/wall");
    await page.getByRole("banner").getByRole("link", { name: "Streaks" }).click();
    await expect(page).toHaveURL(/\/streaks$/);
    await page.waitForTimeout(4_000);
    expect(requests).toEqual([]);
    expect(analyticsEvents(stack, distinctId).some((event) => event.path === "/streaks")).toBe(false);

    await page.goto("/privacy");
    await expect(section.getByText("Off in this browser")).toBeVisible();
    await section.getByRole("button", { name: "Turn on" }).click();
    await expect(section.getByText("On in this browser")).toBeVisible();
    const fresh = await analyticsIdOf(page);
    expect(fresh).not.toBe(distinctId);
    await expect
      .poll(() => analyticsEvents(stack, fresh).map((event) => `${event.name} ${event.path}`), { timeout: 20_000 })
      .toContain("$pageview /privacy");
  });
});
