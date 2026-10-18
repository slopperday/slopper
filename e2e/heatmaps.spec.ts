import { analyticsEvents, analyticsIdOf, expect, test } from "./fixtures.ts";

/**
 * Heatmaps: every click's spot is sent per page, and admins see a page with
 * its clicks over it, in a frame where the page sends no analytics of its own.
 * Other tests click /rules too, so counts are checked as at least ours.
 */

test.describe("heatmaps", () => {
  test("show admins where people click on a page", async ({ seed, stack }) => {
    const visitor = await seed.visitorPage();
    await visitor.setViewportSize({ width: 1280, height: 800 });
    await visitor.goto("/rules");
    const visitorId = await analyticsIdOf(visitor);
    for (const [x, y] of [
      [300, 300],
      [310, 305],
      [900, 500],
    ] as const) {
      await visitor.mouse.click(x, y);
    }
    // Leaving the page sends its clicks.
    await visitor.getByRole("banner").getByRole("link", { name: "Streaks" }).click();
    await expect
      .poll(
        () =>
          analyticsEvents(stack, visitorId)
            .filter((event) => event.name === "$heatmap" && event.path === "/rules")
            .flatMap((event) => {
              const points = event.properties.points;
              return Array.isArray(points) ? points : [];
            }),
        { timeout: 20_000 },
      )
      // And the click on the link that left the page.
      .toEqual(expect.arrayContaining(["300,300", "310,305", "900,500"]));

    const admin = await seed.pageAs(await seed.admin());
    await admin.setViewportSize({ width: 1400, height: 900 });
    const framedSends: string[] = [];
    admin.on("request", (request) => {
      if (request.url().startsWith(stack.convexSiteUrl) && request.frame() !== admin.mainFrame()) {
        framedSends.push(request.url());
      }
    });
    await admin.goto("/analytics/heatmaps?path=%2Frules&device=desktop&days=7");
    const clicks = admin.locator(".panel").filter({ hasText: /^Clicks/ });
    await expect
      .poll(async () => Number((await clicks.locator("p").nth(1).innerText()).replace(/\D/g, "")))
      .toBeGreaterThanOrEqual(3);
    const preview = admin.frameLocator('iframe[title="/rules as it is now"]');
    await expect(preview.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(admin.locator("canvas")).toHaveCount(1);
    await expect(admin.getByRole("region", { name: "How far down" })).toBeVisible();
    await admin.waitForTimeout(4_000);
    expect(framedSends).toEqual([]);

    // A visitor on a phone isn't on the desktop map, and has a map of their own.
    await admin.getByRole("link", { name: "Phone" }).click();
    await expect(admin).toHaveURL(/device=mobile/);
    await expect(admin.locator('iframe[title="/rules as it is now"]')).toHaveAttribute("width", "390");
  });
});
