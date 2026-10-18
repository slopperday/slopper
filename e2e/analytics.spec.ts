import type { Page } from "@playwright/test";
import { analyticsEvents, expect, test } from "./fixtures.ts";

/**
 * First-party analytics (packages/analytics): the browser posts straight to
 * the Convex backend's HTTP actions, and the analytics component keeps it.
 * Each test reads back only the person its own browser became.
 */

async function distinctIdOf(page: Page): Promise<string> {
  await expect.poll(async () => (await page.context().cookies()).some((cookie) => cookie.name === "sa_id")).toBe(true);
  const cookie = (await page.context().cookies()).find((item) => item.name === "sa_id");
  return cookie?.value ?? "";
}

test.describe("analytics", () => {
  test("records a visit: where it came from, the pages seen and what was clicked", async ({ seed, stack }) => {
    const page = await seed.visitorPage();
    const sent = page.waitForRequest((request) => request.url() === `${stack.convexSiteUrl}/a/e`);
    await page.goto("/wall?utm_source=e2e&utm_campaign=launch-week");
    const distinctId = await distinctIdOf(page);
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
    const distinctId = await distinctIdOf(page);
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
    const fresh = await distinctIdOf(page);
    expect(fresh).not.toBe(distinctId);
    await expect
      .poll(() => analyticsEvents(stack, fresh).map((event) => `${event.name} ${event.path}`), { timeout: 20_000 })
      .toContain("$pageview /privacy");
  });
});
