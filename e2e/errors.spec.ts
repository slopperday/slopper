import { analyticsEvents, analyticsIdOf, expect, test } from "./fixtures.ts";

/** Error tracking: an error thrown in a visitor's page becomes an issue admins can trace to the session. */

test.describe("errors", () => {
  test("an uncaught error in a page shows up for admins, with its session", async ({ seed, stack }) => {
    const visitor = await seed.visitorPage();
    await visitor.goto("/rules");
    const visitorId = await analyticsIdOf(visitor);
    await visitor.evaluate(() => {
      setTimeout(() => {
        throw new RangeError("The e2e kaboom went off");
      });
    });
    await expect
      .poll(
        () =>
          analyticsEvents(stack, visitorId)
            .filter((event) => event.name === "$exception")
            .map((event) => [event.properties.type, event.properties.message, event.properties.source]),
        { timeout: 20_000 },
      )
      .toEqual([["RangeError", "The e2e kaboom went off", "uncaught"]]);

    const admin = await seed.pageAs(await seed.admin());
    await admin.goto("/analytics/errors?days=7");
    await admin.getByRole("link", { name: "RangeError: The e2e kaboom went off" }).click();
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText("RangeError");
    await expect(admin.getByRole("region", { name: "Stack" })).toContainText("The e2e kaboom went off");
    await admin
      .getByRole("link", { name: /^(Watch the session|The session)$/ })
      .first()
      .click();
    await expect(admin).toHaveURL(/\/analytics\/sessions\//);
    await expect(admin.getByRole("heading", { level: 1 })).toHaveText("A visit");
  });

  test("are for admins: everyone else gets a 404", async ({ seed }) => {
    const user = await seed.pageAs(await seed.user("errorless"));
    expect((await user.goto("/analytics/errors"))?.status()).toBe(404);
  });
});
