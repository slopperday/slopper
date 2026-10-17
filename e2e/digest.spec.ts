import type { SeededUser, Seed } from "./fixtures.ts";
import { expect, runInternal, sentEmails, test } from "./fixtures.ts";
import type { Stack } from "./ports.ts";

/** A maker with an upvote waiting, and the digest the hourly job sends them a day later. */
async function digestFor(seed: Seed, stack: Stack, prefix: string) {
  const email = `${prefix}-${Date.now()}@e2e.test`;
  const maker = await seed.user(prefix, { email });
  const slop = await seed.slop(maker);
  await seed.vote(await seed.user("fan"), slop, 1);
  // The hourly job a day from now: their 9am has come and gone.
  runInternal(stack, "digest:run", { now: Date.now() + 25 * 3_600_000 });
  const mine = async () => (await sentEmails(stack)).filter((sent) => sent.to.includes(email));
  await expect.poll(async () => (await mine()).length).toBe(1);
  const [sent] = await mine();
  const unsubscribe = /^<(.+)>$/.exec(sent.headers["List-Unsubscribe"])?.[1] ?? "";
  return { email, maker, slop, sent, unsubscribe };
}

async function digestSetting(seed: Seed, user: SeededUser) {
  const page = await seed.pageAs(user);
  await page.goto("/settings");
  return { page, section: page.getByRole("region", { name: "Daily digest" }) };
}

test.describe("daily digest", () => {
  // The digest job is global. Run beside another test, it can reach that test's maker before the upvote lands, send
  // nothing and move their digest to tomorrow, so these tests take turns.
  test.describe.configure({ mode: "default" });

  test("a maker gets yesterday's reactions by email and stops it from the link", async ({ seed, stack }) => {
    const { email, maker, slop, sent, unsubscribe } = await digestFor(seed, stack, "digester");
    expect(sent.subject).toBe("Your slops got 1 upvote");
    expect(sent.text).toContain(slop.name);
    expect(sent.html).toContain("SLOPPER");
    expect(sent.text).toContain(`${stack.appUrl}${slop.path}`);
    expect(sent.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(unsubscribe.startsWith(`${stack.appUrl}/unsubscribe/`)).toBe(true);

    // Opening the link changes nothing (link scanners open them); the button does.
    const page = await seed.visitorPage();
    await page.goto(unsubscribe);
    let { section } = await digestSetting(seed, maker);
    await expect(section.getByText("On", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Stop the digest" }).click();
    await expect(page.getByRole("status")).toContainText("No more digests");

    const settings = await digestSetting(seed, maker);
    section = settings.section;
    await expect(section.getByText(email)).toBeVisible();
    await expect(section.getByText("Off", { exact: true })).toBeVisible();
    await section.getByRole("button", { name: "Turn on" }).click();
    await expect(settings.page.getByRole("status")).toHaveText("Daily digest on.");
  });

  test("mail apps unsubscribe with one POST, and unknown links change nothing", async ({ seed, stack }) => {
    const { maker, unsubscribe } = await digestFor(seed, stack, "oneclick");
    const page = await seed.visitorPage();
    const unknown = await page.request.post(`${stack.appUrl}/unsubscribe/00000000-0000-0000-0000-000000000000`, {
      form: { "List-Unsubscribe": "One-Click" },
    });
    expect(unknown.status()).toBe(404);
    const oneClick = await page.request.post(unsubscribe, { form: { "List-Unsubscribe": "One-Click" } });
    expect(oneClick.status()).toBe(200);

    const { section } = await digestSetting(seed, maker);
    await expect(section.getByText("Off", { exact: true })).toBeVisible();
  });

  test("people without a verified email are told how to get one", async ({ seed }) => {
    const { section } = await digestSetting(seed, await seed.user("noemail"));
    await expect(section).toContainText("None of your sign-in methods shares a verified email");
    await expect(section.getByRole("button")).toHaveCount(0);
  });
});
