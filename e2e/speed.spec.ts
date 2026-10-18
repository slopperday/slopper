import { analyticsEvents, analyticsIdOf, expect, test } from "./fixtures.ts";

/** Web vitals: a real page load's measurements arrive as it's left, and admins read them at /analytics/speed. */

test.describe("speed", () => {
  test("measures a page load and shows admins how fast pages are", async ({ seed, stack }) => {
    const visitor = await seed.visitorPage();
    await visitor.goto("/wall");
    const visitorId = await analyticsIdOf(visitor);
    await visitor.getByRole("searchbox", { name: "Search slops" }).click();
    // Leaving sends the landing page's vitals.
    await visitor.goto("about:blank");
    await expect
      .poll(() => analyticsEvents(stack, visitorId).find((event) => event.name === "$webVitals"), { timeout: 20_000 })
      .toMatchObject({ path: "/wall", properties: { fcp: expect.any(Number), ttfb: expect.any(Number) } });

    const admin = await seed.pageAs(await seed.admin());
    await admin.goto("/analytics/speed?days=7");
    await expect(admin.getByRole("region", { name: "First paint (FCP)" })).toContainText(/\d+(\.\d)? m?s/);
    await expect(
      admin.getByRole("table", { name: /75th percentiles/ }).getByRole("rowheader", { name: "/wall" }),
    ).toBeVisible();
  });
});
