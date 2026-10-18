import { gunzipSync } from "node:zlib";
import type { Page, Request } from "@playwright/test";
import { analyticsEvents, analyticsIdOf, expect, test } from "./fixtures.ts";

/**
 * Session replay: a visit is recorded in chunks with what's typed masked,
 * private pages aren't recorded, and admins play recordings back from
 * /analytics/recordings. Every e2e session is recorded (ANALYTICS_REPLAY_RATE
 * is unset, so 1), and each test reads only the session it made.
 */

interface Chunk {
  sessionId: string;
  text: string;
}

/** Recording chunks a page sent and the server took, decoded. */
function chunksFrom(page: Page): Chunk[] {
  const chunks: Chunk[] = [];
  page.on("requestfinished", (request: Request) => {
    const url = new URL(request.url());
    if (request.method() !== "POST" || url.pathname !== "/a/r") return;
    const body = request.postDataBuffer();
    if (!body) return;
    const text = (url.searchParams.get("z") === "1" ? gunzipSync(body) : body).toString("utf8");
    chunks.push({ sessionId: url.searchParams.get("s") ?? "", text });
  });
  return chunks;
}

test.describe("session replay", () => {
  test("records a visit with what's typed masked, and plays it back for admins", async ({ seed, stack }) => {
    const visitor = await seed.visitorPage();
    const chunks = chunksFrom(visitor);
    await visitor.goto("/wall?utm_source=replay-e2e");
    const visitorId = await analyticsIdOf(visitor);
    await visitor.getByRole("searchbox", { name: "Search slops" }).fill("my secret words");
    await visitor.mouse.move(200, 300);
    await visitor.mouse.move(400, 500);
    await expect.poll(() => chunks.length, { timeout: 20_000 }).toBeGreaterThan(0);
    // Leaving sends what's left.
    await visitor.getByRole("banner").getByRole("link", { name: "Streaks" }).click();
    await expect(visitor).toHaveURL(/\/streaks$/);
    // The streaks page's own words: what was recorded after the navigation.
    await expect
      .poll(() => chunks.some((chunk) => chunk.text.includes("Everyone with a goal running")), { timeout: 20_000 })
      .toBe(true);
    await expect
      .poll(() => analyticsEvents(stack, visitorId).map((event) => `${event.name} ${event.path}`), { timeout: 20_000 })
      .toContain("$pageview /streaks");

    const recorded = chunks.map((chunk) => chunk.text).join("\n");
    expect(recorded).not.toContain("my secret words");
    expect(recorded).toContain("*".repeat("my secret words".length));
    expect(recorded).not.toContain("replay-e2e");
    // Scripts, with the data pages hydrate from, are left out.
    expect(recorded).not.toContain("__reactRouterContext");
    const sessionId = chunks[0]?.sessionId ?? "";
    expect(sessionId).not.toBe("");

    const admin = await seed.pageAs(await seed.admin());
    await admin.goto("/analytics/recordings");
    await admin.locator(`a[href^="/analytics/sessions/${encodeURIComponent(sessionId)}"]`).click();
    await expect(admin.getByRole("heading", { name: "Recording" })).toBeVisible();
    const play = admin.getByRole("button", { name: "Play" });
    await expect(play).toBeVisible({ timeout: 20_000 });
    await expect(admin.locator(".replayer-wrapper iframe")).toHaveCount(1);
    // The landing page view sits at the start: recording begins once the page has loaded.
    await expect(admin.getByRole("button", { name: /^Jump to Page view of \/wall, at 0:00$/ })).toHaveCount(1);
    await expect(admin.getByRole("button", { name: /^Jump to Page view of \/streaks/ })).toHaveCount(1);
    await play.click();
    await expect(admin.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect
      .poll(async () => Number(await admin.getByRole("slider", { name: "Position in the recording" }).inputValue()))
      .toBeGreaterThan(0);
  });

  test("never records pages that are private to you", async ({ seed }) => {
    const page = await seed.pageAs(await seed.user("unrecorded"));
    const chunks = chunksFrom(page);
    await page.goto("/settings/api");
    await analyticsIdOf(page);
    await page.getByLabel("Token name").fill("a token for nobody to see");
    // Longer than the recorder waits between sends.
    await page.waitForTimeout(6_500);
    expect(chunks).toEqual([]);
  });
});
