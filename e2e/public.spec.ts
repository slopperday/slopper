import { expect, test } from "./fixtures.ts";

test.describe("visitors", () => {
  test("can browse the wall without an account", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Every day.");
    await expect(page.getByRole("heading", { name: "Today's race" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Volume beats taste." })).toBeVisible();

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

  test("see the rules without an invitation to post NSFW", async ({ page }) => {
    await page.goto("/rules");
    await expect(page.getByRole("heading", { name: "Keep it safe for work" })).toBeVisible();
    await expect(page.getByText(/tag NSFW/i)).toHaveCount(0);
    await expect(page.getByText("Flag as inappropriate")).toBeVisible();
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
    const feed = await request.get("/feed.xml");
    expect(feed.ok()).toBe(true);
    expect(feed.headers()["content-type"]).toContain("xml");
  });
});

test.describe("signing in", () => {
  test("GitHub sign-in sends people to GitHub with PKCE and a way back", async ({ page, request, stack }) => {
    await page.goto("/login?returnTo=%2Fnew");
    const button = page.getByRole("link", { name: "Continue with GitHub" });
    await expect(button).toHaveAttribute("href", "/auth/github?returnTo=%2Fnew");

    // Follow the button's first hop only: the next one is GitHub itself.
    const response = await request.get("/auth/github?returnTo=%2Fnew", { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers()["set-cookie"]).toContain("slopper_oauth=");
    const url = new URL(response.headers().location ?? "");
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("e2e-github-client");
    expect(url.searchParams.get("redirect_uri")).toBe(`${stack.appUrl}/auth/github/callback`);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  test("a forged OAuth callback is turned away", async ({ page }) => {
    await page.goto("/auth/github/callback?code=stolen&state=made-up");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("alert")).toBeVisible();
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
  test("pages carry security headers", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("ws://127.0.0.1:3410");
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
