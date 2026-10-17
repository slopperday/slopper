import { expect, test } from "./fixtures.ts";

test.describe("visitors", () => {
  test("can browse the wall without an account", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Not enough yet!");
    await expect(page.getByRole("heading", { name: "Today's race" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Volume beats taste." })).toBeVisible();
    // Only networks the server has keys for are named; the stack has them all.
    await expect(page.getByText("Connect X (as many accounts as you like), LinkedIn and Bluesky.")).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Main", exact: true });
    for (const [label, heading] of [
      ["Today", "Today's race"],
      ["The wall", /wall/i],
      ["Slopcessful", /slopcessful/i],
      ["Streaks", /streak/i],
    ] as const) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(heading);
    }
    expect(errors).toEqual([]);
  });

  test("see the race clock in hours and minutes through the last hour, and the seconds on hover", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-18T22:58:30Z") });
    await page.goto("/rules");
    const clock = page.getByRole("banner").getByTitle("Time left in today's race (midnight UTC)");
    const board = clock.locator(".tiles");
    // Steps stop on whole seconds, which the once-a-second tick reads the same whatever its phase.
    const expectClock = async (text: string, words: string, lastHour: boolean) => {
      await expect(board).toHaveText(text);
      await expect(clock.getByText(/^Time left/)).toHaveText(`Time left in today's race: ${words}`);
      if (lastHour) await expect(board).toHaveClass(/tiles-urgent/);
      else await expect(board).not.toHaveClass(/tiles-urgent/);
    };

    await page.clock.pauseAt(new Date("2026-10-18T22:59:30Z"));
    await expectClock("01:00", "1 hour", false);
    await page.clock.runFor(60_000);
    await expectClock("00:59", "59 minutes", true);
    await page.clock.pauseAt(new Date("2026-10-18T23:59:30Z"));
    await expectClock("00:01", "1 minute", true);
    await clock.hover();
    await expect(board).toHaveText("00:00:30");
    await page.mouse.move(0, 0);
    await expect(board).toHaveText("00:01");

    // Midnight starts the next race without a reload.
    await page.clock.runFor(60_000);
    await expectClock("23:59", "23 hours 59 minutes", false);
    await clock.hover();
    await expect(board).toHaveText("23:59:30");
  });

  test("see the rules without an invitation to post NSFW", async ({ page }) => {
    await page.goto("/rules");
    await expect(page.getByRole("heading", { name: "Keep it safe for work" })).toBeVisible();
    await expect(page.getByText(/tag NSFW/i)).toHaveCount(0);
    await expect(page.getByText("Flag as inappropriate")).toBeVisible();
  });

  test("can read the terms and privacy policy from every page", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    await footer.getByRole("link", { name: "Privacy" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
    await expect(page.getByRole("heading", { name: "Who else sees it" })).toBeVisible();
    await page.getByRole("contentinfo").getByRole("link", { name: "Terms" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms");
    await page.goto("/login");
    await expect(page.getByRole("link", { name: "what we keep" })).toHaveAttribute("href", "/privacy");
  });

  test("can see what's new, and which release they're on, from every page", async ({ page }) => {
    const response = await page.goto("/");
    const version = response?.headers()["x-slopper-version"];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: `v${version}` })).toHaveAttribute("href", "/changelog");
    await footer.getByRole("link", { name: "What's new" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("What's new");
  });

  test("are sent to sign in, and back, from pages that need an account", async ({ page }) => {
    for (const path of ["/new", "/goal", "/settings", "/notifications"]) {
      await page.goto(path);
      await expect(page).toHaveURL(`/login?returnTo=${encodeURIComponent(path)}`);
      await expect(page.getByRole("heading", { name: "Start slopping" })).toBeVisible();
    }
  });

  test("get a 404 for slops and people that don't exist", async ({ page }) => {
    const response = await page.goto("/@nobody-here/nothing");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Slid off the wall" })).toBeVisible();
  });

  test("can read the agent guide and the feed", async ({ request }) => {
    const guide = await request.get("/llms.txt");
    expect(guide.ok()).toBe(true);
    expect(await guide.text()).toContain("/mcp");
    expect(await guide.text()).toContain("connected X, LinkedIn and Bluesky accounts");
    const feed = await request.get("/feed.xml");
    expect(feed.ok()).toBe(true);
    expect(feed.headers()["content-type"]).toContain("xml");
  });

  test("get a preview card when they share a link", async ({ page, request }) => {
    await page.goto("/");
    const image = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(image).toMatch(/\/og\.png$/);
    const card = await request.get(new URL(image ?? "").pathname);
    expect(card.ok()).toBe(true);
    expect(card.headers()["content-type"]).toBe("image/png");
  });

  test("see a slop's own card, and the maker's, when they share either link", async ({ seed, request }) => {
    const maker = await seed.user("carded");
    const slop = await seed.slop(maker, { tagline: "A card of its own" });
    const visitor = await seed.visitorPage();
    for (const [path, type, card] of [
      [slop.path, "article", `${slop.path}/card.png`],
      [`/@${maker.username}`, "profile", `/@${maker.username}/card.png`],
    ] as const) {
      await visitor.goto(path);
      const meta = (key: string) =>
        visitor.locator(`meta[property="${key}"], meta[name="${key}"]`).getAttribute("content");
      const image = await meta("og:image");
      expect(new URL(image ?? "").pathname).toBe(card);
      expect(await meta("twitter:image")).toBe(image);
      expect(await meta("og:image:width")).toBe("1200");
      expect(await meta("og:image:height")).toBe("630");
      expect(await meta("og:image:alt")).toContain(`@${maker.username}`);
      expect(await meta("og:type")).toBe(type);

      const response = await request.get(new URL(image ?? "").pathname + new URL(image ?? "").search);
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toBe("image/png");
      const png = await response.body();
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    }
    expect((await request.get(`/@${maker.username}/no-such-slop/card.png`)).status()).toBe(404);
  });
});

test("crawlers stay off the API and sign-in links, but not off profiles", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  const rules = (await robots.text())
    .split("\n")
    .filter((line) => line.startsWith("Disallow:"))
    .map((line) => line.slice("Disallow:".length).trim());
  expect(rules).toEqual(expect.arrayContaining(["/api/", "/auth/"]));
  // Rules match by prefix and profiles live at /<username>: "/new" would hide /newton.
  for (const rule of rules) expect(rule).toMatch(/\/$/);
});

/** Each sign-in button the stack has keys for, and where its first hop must go. */
const SIGN_IN = [
  {
    provider: "github",
    label: "GitHub",
    authorize: /^https:\/\/github\.com\/login\/oauth\/authorize$/,
    scope: "read:user user:email",
    pkce: true,
  },
  {
    provider: "x",
    label: "X",
    authorize: /^https:\/\/x\.com\/i\/oauth2\/authorize$/,
    // Read-only: signing in never asks to post.
    scope: "users.read tweet.read",
    pkce: true,
  },
  {
    provider: "linkedin",
    label: "LinkedIn",
    authorize: /^https:\/\/www\.linkedin\.com\/oauth\/v2\/authorization$/,
    scope: "openid profile email",
    pkce: false,
  },
  {
    provider: "facebook",
    label: "Facebook",
    authorize: /^https:\/\/www\.facebook\.com\/v\d+\.0\/dialog\/oauth$/,
    scope: "public_profile email",
    pkce: true,
  },
] as const;

test.describe("signing in", () => {
  for (const { provider, label, authorize, scope, pkce } of SIGN_IN) {
    test(`${label} sign-in sends people to ${label} with a state and a way back`, async ({ page, request, stack }) => {
      await page.goto("/login?returnTo=%2Fnew");
      const href = `/auth/${provider}?intent=login&returnTo=%2Fnew`;
      await expect(page.getByRole("link", { name: `Continue with ${label}`, exact: true })).toHaveAttribute(
        "href",
        href,
      );

      // Follow the button's first hop only: the next one is the provider itself.
      const response = await request.get(href, { maxRedirects: 0 });
      expect(response.status()).toBe(302);
      const state = /slopper_oauth=([^;]+)/.exec(response.headers()["set-cookie"] ?? "")?.[1];
      expect(state).toBeTruthy();
      const url = new URL(response.headers().location ?? "");
      expect(url.origin + url.pathname).toMatch(authorize);
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("client_id")).toBe(`e2e-${provider}-client`);
      expect(url.searchParams.get("redirect_uri")).toBe(`${stack.appUrl}/auth/${provider}/callback`);
      expect(url.searchParams.get("scope")).toBe(scope);
      // The state in the URL is the one this browser holds.
      expect(url.searchParams.get("state")).toBe(state);
      if (pkce) {
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
      } else {
        expect(url.searchParams.has("code_challenge")).toBe(false);
      }
    });
  }

  test("only providers with keys get a button", async ({ page }) => {
    await page.goto("/login");
    const buttons = page.getByRole("link", { name: /^Continue with / });
    await expect(buttons).toHaveText([
      "Continue with GitHub",
      "Continue with X",
      "Continue with LinkedIn",
      "Continue with Facebook",
    ]);
  });

  test("a forged OAuth callback is turned away", async ({ page }) => {
    await page.goto("/auth/github/callback?code=stolen&state=made-up");
    // Nothing from the callback's query survives the redirect (see ~/lib/redirect).
    await expect(page).toHaveURL((url) => url.pathname === "/login" && url.search === "");
    await expect(page.getByRole("alert")).toBeVisible();
  });

  test("redirects carry a query of their own, so Netlify doesn't copy the request's", async ({ request }) => {
    const response = await request.get("/auth/github/callback?code=stolen&state=made-up", { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe("/login?_");
  });

  test("production has no password-free dev login", async ({ page, request }) => {
    await page.goto("/login");
    await expect(page.getByText("Local dev login")).toHaveCount(0);
    const response = await request.post("/auth/dev", { form: { username: "intruder" } });
    expect(response.status()).toBe(404);
  });

  test("signing out ends the session", async ({ seed }) => {
    const person = await seed.user("leaver");
    const page = await seed.pageAs(person);
    await page.goto("/");
    await page.getByLabel("Account menu").click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("link", { name: "Start slopping" }).first()).toBeVisible();
    await page.goto("/new");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("production hardening", () => {
  test("pages carry security headers", async ({ request, stack }) => {
    const response = await request.get("/");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain(stack.convexUrl.replace(/^http/, "ws"));
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  test("cross-site form posts are refused", async ({ request, seed }) => {
    const person = await seed.user("target");
    const response = await request.post("/settings", {
      headers: { origin: "https://evil.example", cookie: `slopper_session=${person.token}` },
      form: { username: `${person.username.slice(0, 20)}-pwned`, displayName: "Pwned" },
      maxRedirects: 0,
    });
    // React Router turns away a foreign origin (400) before our own check (403) gets to.
    expect([400, 403]).toContain(response.status());
    const page = await seed.pageAs(person);
    await page.goto("/settings");
    await expect(page.getByLabel("Username")).toHaveValue(person.username);
  });
});
