import { test, expect } from "./fixtures";
import { HACKER_HOUSE, hackerHouseActive } from "../app/lib/hackerHouse";

test("hacker house modes persist, prefill the tag, and disappear at the deadline", async ({ seed }) => {
  test.skip(!hackerHouseActive(Date.now()), "The temporary challenge is only available during its event.");
  const maker = await seed.user("hacker");
  const page = await seed.pageAs(maker);
  await page.goto("/");
  const challenge = page.getByRole("region", { name: "Solana Hacker House" });
  await challenge.getByRole("button", { name: "Intense" }).click();
  await expect(challenge.getByRole("status")).toHaveText("0 / 10 apps shipped");
  await page.reload();
  await expect(challenge.getByRole("button", { name: "Intense" })).toHaveAttribute("aria-pressed", "true");
  await challenge.getByRole("button", { name: "Modest" }).click();
  await expect(challenge.getByRole("status")).toHaveText("0 / 3 apps shipped");
  await challenge.getByRole("link", { name: "Ship a hacker house app" }).click();
  await expect(page.locator('input[type="hidden"][name="madeWith"]')).toHaveValue(HACKER_HOUSE.tag);
  await page.goto("/");
  await expect(challenge).toBeVisible();
  await page.clock.install({ time: HACKER_HOUSE.end - 1000 });
  await page.clock.runFor(2000);
  await expect(challenge).toHaveCount(0);
});
