import { api } from "../convex/_generated/api.js";
import { expect, test } from "./fixtures.ts";

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
    await page.getByRole("radio", { name: /Warm-up/ }).check({ force: true });
    await page.getByRole("button", { name: "Set the goal" }).click();
    await expect(page.getByRole("status")).toHaveText("Goal set: 7 slops in 7 days. Start throwing.");

    await page.goto("/goal");
    await page.getByText("Drop this goal").click();
    await page.getByRole("button", { name: "Yes, drop it" }).click();
    await expect(page.getByRole("status")).toHaveText("Goal dropped. Set a new one when you're ready.");
    await expect(page.getByRole("heading", { name: "Set a goal" })).toBeVisible();
  });

  test("sign-in methods can be linked and unlinked, but never the last one", async ({ seed, convex, stack }) => {
    const person = await seed.user("linker");
    const page = await seed.pageAs(person);
    await page.goto("/settings");
    const methods = page.locator("section", { has: page.getByRole("heading", { name: "Sign-in methods" }) });
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
    await expect(page.getByRole("status")).toHaveText("Unlinked GitHub. It won't sign you in any more.");
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
    await page.reload();
    await expect(page.getByRole("alert")).toHaveText("Facebook is your only way in. Link another first.");
    await expect(methods.getByRole("listitem").filter({ hasText: "Facebook" })).toContainText("Your only way in");
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
