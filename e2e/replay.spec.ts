import { gunzipSync, gzipSync } from "node:zlib";
import type { Page, Request } from "@playwright/test";
import { analyticsEvents, analyticsIdOf, expect, test } from "./fixtures.ts";
import { REPLAY_LIMITS } from "../packages/analytics/src/shared/replay.ts";

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

    // Stored recording bytes are untrusted, including when the metadata is valid.
    const oversized = JSON.stringify([
      { type: 5, timestamp: 1, data: { tag: "oversized", payload: "x".repeat(REPLAY_LIMITS.expandedChunkBytes) } },
    ]);
    await admin.route("**/api/storage/**", async (route) => {
      const response = await route.fetch();
      const gzip = response.headers()["content-type"]?.startsWith("application/gzip") ?? false;
      await route.fulfill({
        headers: { "access-control-allow-origin": "*", "content-type": gzip ? "application/gzip" : "application/json" },
        body: gzip ? gzipSync(oversized) : oversized,
      });
    });
    await admin.reload();
    await expect(admin.getByRole("alert")).toHaveText("The recording exceeds its expanded byte limit.");
    await expect(admin.getByRole("button", { name: "Play", exact: true })).toHaveCount(0);
  });

  for (const surface of ["keys", "launch", "goal", "edit"] as const) {
    test(`never records the owner's ${surface} page`, async ({ seed }) => {
      const owner = await seed.user("unrecorded");
      const path =
        surface === "edit"
          ? `${(await seed.slop(owner)).path}/edit`
          : { keys: "/settings/api", launch: "/new", goal: "/goal" }[surface];
      const page = await seed.pageAs(owner);
      const chunks = chunksFrom(page);
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await analyticsIdOf(page);
      // Longer than the recorder waits between sends.
      await page.waitForTimeout(6_500);
      expect(chunks).toEqual([]);
    });
  }

  test("pauses on a launch page during navigation and resumes on public pages", async ({ seed }) => {
    const page = await seed.pageAs(await seed.user("replaynavigation"));
    const chunks = chunksFrom(page);
    await page.goto("/wall");
    await expect.poll(() => chunks.length, { timeout: 20_000 }).toBeGreaterThan(0);

    await page.getByRole("banner").getByRole("link", { name: "New slop" }).click();
    await expect(page).toHaveURL(/\/new$/);
    const privateHeading = await page.locator("main h1").innerText();
    await page.waitForTimeout(6_500);
    expect(chunks.some((chunk) => chunk.text.includes(privateHeading))).toBe(false);

    await page.getByRole("banner").getByRole("link", { name: "Streaks", exact: true }).click();
    await expect(page).toHaveURL(/\/streaks$/);
    await expect
      .poll(() => chunks.some((chunk) => chunk.text.includes("Everyone with a goal running")), { timeout: 20_000 })
      .toBe(true);
    expect(chunks.some((chunk) => chunk.text.includes(privateHeading))).toBe(false);
  });
});
