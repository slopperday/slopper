import { devices, type APIRequestContext } from "@playwright/test";
import { uuidv7 } from "@slopperday/analytics/shared";
import { analyticsEvents, expect, test } from "./fixtures.ts";
import type { Stack } from "./ports.ts";

/**
 * Feature flags and experiments: an admin makes a flag, turns it on and
 * runs an experiment on it, and the first page a visitor opens gives them
 * the id flags bucket them by. Flags are shared by every worker, so each
 * test makes its own under a key no other test uses.
 */

/** Sends events to the analytics endpoint the way the browser SDK does. */
async function sendEvents(
  request: APIRequestContext,
  stack: Stack,
  events: { name: string; distinctId: string; properties: Record<string, string> }[],
): Promise<void> {
  const now = Date.now();
  const response = await request.post(`${stack.convexSiteUrl}/a/e`, {
    headers: {
      origin: stack.appUrl,
      "content-type": "text/plain",
      "user-agent": devices["Desktop Chrome"].userAgent,
    },
    data: JSON.stringify({
      sentAt: now,
      events: events.map((event) => ({
        ...event,
        uuid: uuidv7(),
        sessionId: null,
        timestamp: now,
        path: "/",
        set: null,
        setOnce: null,
      })),
    }),
  });
  expect(response.ok()).toBe(true);
}

test.describe("flags and experiments", () => {
  test("an admin makes a flag, turns it on and runs an experiment on it", async ({ seed, request, stack }) => {
    const admin = await seed.pageAs(await seed.admin());
    const key = `e2e-${uuidv7().slice(-10)}`;

    await admin.goto("/analytics/flags");
    await admin.getByLabel("Key", { exact: true }).fill(key);
    await admin.getByLabel("Name", { exact: true }).fill("A test of the wall");
    // One variant isn't a split: the form says why and keeps what was typed.
    await admin.getByLabel(/^Variants/).fill("control 1");
    await admin.getByRole("button", { name: "Make the flag" }).click();
    await expect(admin.getByRole("alert")).toHaveText("A flag with variants needs two at least.");
    await expect(admin.getByLabel("Key", { exact: true })).toHaveValue(key);

    await admin.getByLabel(/^Variants/).fill("control 1\ntest 1");
    await admin.getByRole("button", { name: "Make the flag" }).click();
    await expect(admin).toHaveURL(`/analytics/flags/${key}`);
    await expect(admin.getByText(`${key} is made. It's off until you turn it on.`)).toBeVisible();
    await admin.getByRole("button", { name: `${key}: off, turn it on` }).click();
    await expect(admin.getByRole("button", { name: `${key}: on, turn it off` })).toBeVisible();

    await admin.getByRole("link", { name: "Set one up" }).click();
    await expect(admin.getByRole("combobox", { name: "Flag", exact: true })).toHaveValue(key);
    await admin.getByLabel("Key", { exact: true }).fill(`${key}-run`);
    await admin.getByLabel("Name", { exact: true }).fill("Does the test variant get more goals");
    await admin.getByRole("combobox", { name: /^Goal/ }).fill("e2e goal");
    await admin.getByRole("button", { name: "Set it up" }).click();
    await expect(admin).toHaveURL(`/analytics/experiments/${key}-run`);
    await expect(admin.getByText("No results until it starts.")).toBeVisible();
    await admin.getByRole("button", { name: "Start it" }).click();
    await expect(admin.getByText("Started. People get variants from now.")).toBeVisible();

    // Two people saw it, one of each variant, and the one who saw control reached the goal.
    const [first, second] = [uuidv7(), uuidv7()];
    await sendEvents(request, stack, [
      { name: "$featureFlagCalled", distinctId: first, properties: { flag: key, variant: "control" } },
      { name: "$featureFlagCalled", distinctId: second, properties: { flag: key, variant: "test" } },
    ]);
    await sendEvents(request, stack, [{ name: "e2e goal", distinctId: first, properties: {} }]);
    await expect.poll(() => analyticsEvents(stack, first).length, { timeout: 20_000 }).toBe(2);

    await admin.reload();
    const results = admin.getByRole("table", { name: /chance to win/ });
    // People, converted, rate (with its likely range), chance it's best.
    await expect(results.getByRole("row", { name: /^control/ }).getByRole("cell")).toHaveText([
      "1",
      "1",
      /^100%/,
      /%$/,
    ]);
    await expect(results.getByRole("row", { name: /^test/ }).getByRole("cell")).toHaveText(["1", "0", /^0%/, /%$/]);
    await expect(admin.getByRole("status")).toContainText("No winner yet");

    await admin.getByRole("button", { name: "Stop it" }).click();
    await expect(admin.getByText("Stopped. Its flag stays as it is.")).toBeVisible();

    // A flag an experiment uses can't go until the experiment does.
    await admin.goto(`/analytics/flags/${key}`);
    await admin.getByRole("button", { name: "Delete the flag" }).click();
    await expect(admin.getByRole("alert")).toHaveText(
      "The experiment “Does the test variant get more goals” uses this flag: delete it first.",
    );

    await admin.goto("/mod/team");
    const log = admin.getByRole("region", { name: "Staff log" }).getByRole("listitem");
    for (const entry of [
      `made the flag ${key}`,
      `turned the flag ${key} on`,
      `set up the experiment ${key}-run`,
      `started the experiment ${key}-run`,
      `stopped the experiment ${key}-run`,
    ]) {
      await expect(log.filter({ hasText: entry })).toHaveCount(1);
    }
  });

  test("are for admins: everyone else gets a 404", async ({ seed }) => {
    const user = await seed.pageAs(await seed.user("flagless"));
    for (const path of ["/analytics/flags", "/analytics/experiments"]) {
      expect((await user.goto(path))?.status(), path).toBe(404);
    }
  });

  test("a visitor's first page gives them the id flags bucket them by", async ({ seed, stack }) => {
    const visitor = await seed.visitorPage();
    const response = await visitor.goto("/rules");
    const minted = (await response?.headerValue("set-cookie")) ?? "";
    const id = /sa_id=([^;]+)/.exec(minted)?.[1];
    expect(id, "the page sets sa_id").toBeTruthy();
    // The SDK, once it loads, keeps the id the server gave them.
    await expect
      .poll(() => analyticsEvents(stack, id ?? "").map((event) => event.distinctId), { timeout: 20_000 })
      .toContain(id);

    const optedOut = await seed.visitorPage();
    await optedOut.context().addCookies([{ name: "sa_off", value: "1", url: stack.appUrl }]);
    const quiet = await optedOut.goto("/rules");
    expect((await quiet?.headerValue("set-cookie")) ?? "").not.toContain("sa_id=");
  });
});
