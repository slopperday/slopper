import type { APIRequestContext } from "@playwright/test";
import { analyticsEvents, expect, test } from "./fixtures.ts";

/**
 * Analytics costs the first page load nothing: the SDK isn't in any script
 * the page loads, and arrives (and first sends) only after the load event.
 * And leaving a page at once still sends what it saw.
 */

/** A selector only the analytics SDK's autocapture has: how its code is recognized in a script. */
const SDK_MARKER = "[data-no-capture]";

/** Every script a page's HTML loads or preloads. */
async function scriptsOf(request: APIRequestContext, path: string): Promise<string[]> {
  const html = await (await request.get(path)).text();
  const sources = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+\.js)"/g)].map((match) => match[1] ?? "");
  // Module scripts import more: the entry's static imports load before anything runs too.
  const inline = [...html.matchAll(/import\("([^"]+\.js)"\)|from\s*"([^"]+\.js)"/g)].map(
    (match) => match[1] ?? match[2] ?? "",
  );
  return [...new Set([...sources, ...inline].filter(Boolean))];
}

test.describe("analytics and page load", () => {
  test("isn't in any script a page loads to render", async ({ request }) => {
    for (const path of ["/", "/wall", "/rules"]) {
      const scripts = await scriptsOf(request, path);
      expect(scripts.length, path).toBeGreaterThan(0);
      for (const script of scripts) {
        expect(await (await request.get(script)).text(), `${path}: ${script}`).not.toContain(SDK_MARKER);
      }
    }
  });

  test("arrives, and sends, only after the page has loaded", async ({ seed }) => {
    const page = await seed.visitorPage();
    const sdk: Promise<string | null>[] = [];
    page.on("response", (response) => {
      if (!response.url().endsWith(".js")) return;
      sdk.push(response.text().then((code) => (code.includes(SDK_MARKER) ? response.url() : null)));
    });
    const firstSend = page.waitForRequest((request) => request.url().endsWith("/a/e"));
    await page.goto("/wall");
    const send = await firstSend;
    await send.response();
    const urls = (await Promise.all(sdk)).filter((url): url is string => url !== null);
    expect(urls).toHaveLength(1);
    // Wall-clock times: keepalive requests get no resource timing entry of their own.
    const timing = await page.evaluate((sdkUrl) => {
      const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      const resource = performance.getEntriesByType("resource").find((entry) => entry.name === sdkUrl);
      return {
        loaded: performance.timeOrigin + (navigation?.loadEventEnd ?? Number.NaN),
        sdk: performance.timeOrigin + (resource?.startTime ?? Number.NaN),
      };
    }, urls[0] ?? "");
    expect(timing.sdk).toBeGreaterThanOrEqual(timing.loaded);
    expect(send.timing().startTime).toBeGreaterThan(timing.sdk);
  });

  test("still sends what a page saw when it's left at once", async ({ seed, stack }) => {
    const page = await seed.visitorPage();
    await page.goto("/wall");
    await expect
      .poll(async () => (await page.context().cookies()).some((cookie) => cookie.name === "sa_id"))
      .toBe(true);
    const id = (await page.context().cookies()).find((cookie) => cookie.name === "sa_id")?.value ?? "";
    // Long before the next batch would go: the leave rides a beacon as the page unloads.
    await page.goto("/rules");
    await expect
      .poll(() => analyticsEvents(stack, id).map((event) => `${event.name} ${event.path}`), { timeout: 20_000 })
      .toEqual(expect.arrayContaining(["$pageview /wall", "$pageleave /wall"]));
  });
});
