import { api } from "../convex/_generated/api.js";
import { choose, expect, test } from "./fixtures.ts";

test.describe("settings", () => {
  test("a new username moves the profile and every slop with it", async ({ seed }) => {
    const maker = await seed.user("renamer");
    const slop = await seed.slop(maker);
    const page = await seed.pageAs(maker);
    const next = `${maker.username.slice(0, 24)}-new`;

    await page.goto("/settings");
    await page.getByLabel("Username").fill(next);
    await page.getByLabel("Display name").fill("Renamed Maker");
    await page.getByLabel("Bio").fill("Throwing slop daily.");
    await page.getByLabel("Time zone").selectOption("Europe/London");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");

    await page.goto(`/@${next}`);
    await expect(page.getByText("Renamed Maker").first()).toBeVisible();
    await expect(page.getByText("Throwing slop daily.")).toBeVisible();
    await page.goto(`/@${next}/${slop.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(slop.name);
  });

  test("motion can be kept still, and the next page arrives still", async ({ seed }) => {
    const page = await seed.pageAs(await seed.user("stillness"));
    await page.goto("/settings");
    const motion = page.getByRole("group", { name: "Motion" });
    await expect(motion.getByRole("radio", { name: /Like my device/ })).toBeChecked();
    await motion.getByRole("radio", { name: /Keep still/ }).check();
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
    await page.goto("/wall");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
    await page.goto("/settings");
    await page
      .getByRole("group", { name: "Motion" })
      .getByRole("radio", { name: /Like my device/ })
      .check();
    await expect(page.locator("html")).not.toHaveAttribute("data-motion", /.+/);
  });

  test("usernames that are taken or reserved are refused", async ({ seed }) => {
    const taken = await seed.user("taken");
    const page = await seed.pageAs(await seed.user("wannabe"));
    await page.goto("/settings");
    await page.getByLabel("Username").fill(taken.username);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toBeVisible();

    await page.getByLabel("Username").fill("moderator");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("a goal can be dropped and set again", async ({ seed }) => {
    const page = await seed.pageAs(await seed.user("quitter"));
    await page.goto("/goal");
    await choose(page, "7 days");
    await page.getByRole("button", { name: "Set the goal" }).click();
    await expect(page.getByRole("status")).toHaveText("Goal set: 7 slops in 7 days.");

    await page.goto("/goal");
    await page.getByText("Drop this goal").click();
    await page.getByRole("button", { name: "Yes, drop it" }).click();
    await expect(page.getByRole("status")).toHaveText("Goal dropped.");
    await expect(page.getByRole("heading", { name: "Set a goal" })).toBeVisible();
  });

  test("a goal starts with the days, then the pace, then asks to be shared", async ({ seed }) => {
    const page = await seed.pageAs(await seed.user("committer"));
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/goal");
    await expect(page.getByRole("heading", { name: "First, a goal." })).toBeVisible();

    // Other days drive every pace card.
    await page.getByLabel("Other number of days").fill("10");
    await expect(page.getByRole("radio", { name: "30 days" })).not.toBeChecked();
    await expect(page.getByText("How many slops in 10 days?")).toBeVisible();
    const safe = page.getByRole("radio", { name: /Safe/ });
    await expect(safe.locator("xpath=following-sibling::span")).toContainText("2/10");

    // Picked by clicking the card, as people do; the mouse stays on it.
    await page.getByText("One every five days.").click();
    await expect(safe).toBeChecked();
    const background = (radio: typeof safe) =>
      radio.locator("xpath=following-sibling::span").evaluate((card) => getComputedStyle(card).backgroundColor);
    const ink = await page.evaluate(() => getComputedStyle(document.body).color);
    // Polled: the colour eases in.
    await expect.poll(() => background(safe)).toBe(ink);
    expect(await background(page.getByRole("radio", { name: /Hardcore/ }))).not.toBe(ink);
    await expect(page.getByText("2 slops in 10 days", { exact: true })).toBeAttached();

    await page.getByRole("button", { name: "Set the goal" }).click();
    await expect(page.getByRole("status")).toHaveText("Goal set: 2 slops in 10 days.");
    const share = page.getByRole("region", { name: "Share your goal" });
    await expect(share).toContainText("I'm throwing 2 slops at the wall in 10 days. Hold me to it.");
    await expect(share.getByRole("link", { name: "X" })).toHaveAttribute("href", /^https:\/\/x\.com\/intent\/post\?/);
  });

  test("sign-in methods can be linked and unlinked, but never the last one", async ({ seed, convex, stack }) => {
    const person = await seed.user("linker");
    const page = await seed.pageAs(person);
    await page.goto("/settings");
    const methods = page.getByRole("region", { name: "Sign-in methods" });
    for (const [provider, label] of [
      ["github", "GitHub"],
      ["x", "X"],
      ["linkedin", "LinkedIn"],
      ["facebook", "Facebook"],
    ] as const) {
      await expect(methods.getByRole("link", { name: `Link ${label}`, exact: true })).toHaveAttribute(
        "href",
        `/auth/${provider}?intent=link`,
      );
    }
    // No keys, no row.
    await expect(methods.getByText("Google")).toHaveCount(0);

    // Linking is a sign-in flow, with sign-in scopes, back to the one redirect URI.
    const start = await page.request.get("/auth/x?intent=link", { maxRedirects: 0 });
    expect(start.status()).toBe(302);
    const authorize = new URL(start.headers().location ?? "");
    expect(authorize.origin + authorize.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(authorize.searchParams.get("scope")).toBe("users.read tweet.read");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${stack.appUrl}/auth/x/callback`);
    expect(authorize.searchParams.get("state")).toBeTruthy();

    // Linked as the callback would link it, it can be unlinked here.
    await convex.mutation(api.users.linkIdentity, {
      userId: person.id,
      provider: "github",
      providerId: `e2e-${person.username}`,
    });
    await page.reload();
    await methods.getByRole("button", { name: "Unlink GitHub" }).click();
    await expect(page.getByRole("status")).toHaveText("Unlinked GitHub.");
    await expect(methods.getByRole("link", { name: "Link GitHub", exact: true })).toBeVisible();

    // Down to one way in, it stays.
    await convex.mutation(api.users.linkIdentity, {
      userId: person.id,
      provider: "facebook",
      providerId: `e2e-${person.username}`,
    });
    await convex.mutation(api.users.unlinkIdentity, { userId: person.id, provider: "e2e" });
    await page.reload();
    await expect(methods.getByRole("listitem").filter({ hasText: "Facebook" })).toContainText("Your only way in");
    await expect(methods.getByRole("button", { name: /^Unlink/ })).toHaveCount(0);
    const refused = await page.request.post("/settings", {
      form: { intent: "unlink", provider: "facebook" },
      maxRedirects: 0,
    });
    expect(refused.status()).toBe(302);

    // Background requests can finish before the redirect's page gets its one-shot message.
    for (const path of ["/api/convex-token", "/settings.data?_routes=routes%2Fsettings"]) {
      const background = await page.request.get(path);
      expect(background.status()).toBe(200);
      expect(background.headers()["set-cookie"] ?? "").not.toContain("slopper_flash=");
    }

    await page.reload();
    await expect(page.getByRole("alert")).toHaveText("Facebook is your only way in. Link another first.");
    await expect(methods.getByRole("listitem").filter({ hasText: "Facebook" })).toContainText("Your only way in");

    await page.reload();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("linking and connecting need an account; connecting keeps its posting scopes", async ({ seed, request }) => {
    for (const [path, home] of [
      ["/auth/github?intent=link", "/settings"],
      ["/auth/x", "/settings/autopost"],
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(302);
      expect(response.headers().location).toBe(`/login?returnTo=${encodeURIComponent(home)}`);
    }

    const page = await seed.pageAs(await seed.user("poster"));
    await page.goto("/settings/autopost");
    await expect(page.getByRole("link", { name: "Connect X" })).toHaveAttribute("href", "/auth/x?intent=connect");
    // Links from before X could sign in still connect.
    for (const [path, scope] of [
      ["/auth/x", "tweet.read tweet.write users.read offline.access"],
      ["/auth/x?intent=connect", "tweet.read tweet.write users.read offline.access"],
      ["/auth/linkedin", "openid profile w_member_social"],
    ]) {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(new URL(response.headers().location ?? "").searchParams.get("scope")).toBe(scope);
    }
    // Sign-in-only providers have no connect flow.
    expect((await page.request.get("/auth/facebook?intent=connect", { maxRedirects: 0 })).status()).toBe(404);
  });
});
