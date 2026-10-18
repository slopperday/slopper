import { randomUUID } from "node:crypto";
import { api } from "../convex/_generated/api.js";
import { analyticsIdOf, expect, test } from "./fixtures.ts";

/**
 * Surveys: an admin sets one up and starts it, a visitor on a matching page
 * answers it once, and the answer shows on its results. Surveys are shared
 * by every worker, so this one targets a page no other test opens.
 */

test.describe("surveys", () => {
  test("an admin asks a question, a visitor answers it once, and the answer shows", async ({ seed, stack, convex }) => {
    // Runs reuse a local stack: surveys an earlier run left running on /terms would be asked first.
    const boss = await seed.admin();
    for (const left of await convex.query(api.analytics.surveys, { adminId: boss.id })) {
      if (left.key.startsWith("e2e-") && left.status === "running") {
        await convex.mutation(api.analytics.stopSurvey, { adminId: boss.id, key: left.key });
      }
    }
    const key = `e2e-${randomUUID().slice(0, 8)}`;
    // Its own question too: a survey another run left running on /terms is another card.
    const question = `How clear were these terms? (${key})`;
    const admin = await seed.pageAs(boss);
    await admin.goto("/analytics/surveys");
    await admin.getByLabel("Key", { exact: true }).fill(key);
    await admin.getByLabel(/^Name/).fill("How the terms read");
    await admin.getByLabel("Question", { exact: true }).fill(question);
    await admin.getByLabel("They answer with").selectOption("rating");
    await admin.getByLabel(/^Then ask/).fill("What was unclear?");
    await admin.getByLabel("On pages starting with").fill("/terms");
    await admin.getByLabel("After this many seconds").fill("0");
    await admin.getByRole("button", { name: "Set it up" }).click();
    await expect(admin).toHaveURL(`/analytics/surveys/${key}`);
    await admin.getByRole("button", { name: "Start asking" }).click();
    await expect(admin.getByText("Started. People are asked from now.")).toBeVisible();

    const visitor = await seed.visitorPage();
    await visitor.goto("/terms");
    await analyticsIdOf(visitor);
    const card = visitor.getByRole("complementary", { name: question });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole("button", { name: "4", exact: true }).click();
    await expect(visitor.getByRole("complementary", { name: "What was unclear?" })).toBeVisible();
    await visitor.getByLabel("Your answer").fill("The bit about votes");
    await visitor.getByRole("button", { name: "Send" }).click();
    await expect(visitor.getByRole("complementary", { name: "Thanks. That helps." })).toBeVisible();
    // Leaving sends the answer; coming back doesn't ask again.
    await visitor.goto("/rules");
    await visitor.goto("/terms");
    await visitor.waitForTimeout(3_000);
    await expect(visitor.getByRole("complementary", { name: question })).toHaveCount(0);

    await expect
      .poll(
        async () => {
          await admin.reload();
          return await admin.getByRole("region", { name: "In their words" }).innerText();
        },
        { timeout: 20_000 },
      )
      .toContain("The bit about votes");
    await expect(admin.locator(".panel").filter({ hasText: /^Average/ })).toContainText("4.0");

    // Someone who turned analytics off is never asked.
    const quiet = await seed.visitorPage();
    await quiet.context().addCookies([{ name: "sa_off", value: "1", url: stack.appUrl }]);
    await quiet.goto("/terms");
    await quiet.waitForTimeout(3_000);
    await expect(quiet.getByRole("complementary", { name: question })).toHaveCount(0);

    await admin.getByRole("button", { name: "Stop asking" }).click();
    await expect(admin.getByText("Stopped. Its answers stay.")).toBeVisible();
  });
});
