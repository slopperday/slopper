import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

/** Runs the slopper CLI from source (packages/cli), the way an agent would, and parses its JSON. */
async function slopper(env: Record<string, string>, ...args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await promisify(execFile)("node", ["packages/cli/src/slopper.ts", ...args], {
    env: { ...process.env, ...env },
  });
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function mcp(request: APIRequestContext, token: string, method: string, params: object = {}) {
  const response = await request.post("/mcp", {
    headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method, params },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { result?: Record<string, unknown>; error?: { message: string } };
}

test.describe("agents run Slopper", () => {
  test("a token made in settings drives the REST API and MCP, until it's revoked", async ({ seed, request }) => {
    const maker = await seed.user("agentic");
    const page = await seed.pageAs(maker);
    await page.goto("/settings/api");
    await page.getByLabel("Token name").fill("Claude Code on my laptop");
    await page.getByRole("button", { name: "Create token" }).click();
    await expect(page.getByText("Your new token. Copy it now; it won't be shown again.")).toBeVisible();
    // Hidden until asked for, here and in the snippets, in case the screen is being shared.
    const shown = page.getByTestId("new-token");
    await expect(shown).toHaveText(/^slp_•+$/);
    await expect(page.getByText(/Bearer slp_[^•]/)).toHaveCount(0);

    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy token" }).click();
    const token = await page.evaluate(() => navigator.clipboard.readText());
    expect(token).toMatch(/^slp_[\w-]{20,}$/);

    await page.getByRole("button", { name: "Reveal token" }).click();
    await expect(shown).toHaveText(token);
    // The connection snippets carry it once it's revealed.
    await expect(page.getByText(`Authorization: Bearer ${token}`).first()).toBeVisible();
    await page.getByRole("button", { name: "Hide token" }).click();
    await expect(shown).toHaveText(/^slp_•+$/);

    const headers = { authorization: `Bearer ${token}` };
    const me = await request.get("/api/v1/me", { headers });
    expect(me.ok()).toBe(true);
    expect(JSON.stringify(await me.json())).toContain(maker.username);

    const name = `Agent slop ${Date.now().toString(36)}`;
    const created = await request.post("/api/v1/slops", {
      headers,
      data: {
        name,
        tagline: "Launched by an agent",
        category: "ai",
        links: [{ kind: "website", url: "https://agent.example/" }],
        autopost: true,
      },
    });
    expect(created.status()).toBe(201);
    const body = (await created.json()) as Record<string, unknown> & {
      autopost: unknown;
      slop: { url: string; nsfw: boolean; hidden: boolean };
    };
    // It says what people see, never how it was checked.
    expect(body.slop).toMatchObject({ nsfw: false, hidden: false });
    expect(body).not.toHaveProperty("contentCheck");
    // Nothing is connected, so nothing went out.
    expect(body.autopost).toEqual({ status: "posted", results: [] });

    const invalid = await request.post("/api/v1/slops", { headers, data: { name: "No tagline" } });
    expect(invalid.status()).toBe(422);

    // MCP: same operations, JSON-RPC.
    const tools = await mcp(request, token, "tools/list");
    const names = ((tools.result?.tools ?? []) as { name: string }[]).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["create_slop", "post_update", "todays_race", "set_goal", "vote"]));
    // Slopcessful is won on votes, never declared.
    expect(names).not.toContain("mark_slopcessful");
    const mine = await mcp(request, token, "tools/call", { name: "list_my_slops", arguments: {} });
    expect(mine.result?.isError).toBe(false);
    expect(JSON.stringify(mine.result?.structuredContent)).toContain(name);
    // Comments are off: no feedback counts for agents either.
    expect(JSON.stringify(mine.result?.structuredContent)).not.toContain('"feedback"');
    const race = await mcp(request, token, "tools/call", { name: "todays_race", arguments: {} });
    expect(race.result?.structuredContent).toMatchObject({ date: new Date().toISOString().slice(0, 10) });

    // Voting spends one of the day's votes.
    const rival = await seed.slop(await seed.user("rival"));
    const voted = await request.post(`/api/v1/slops/${rival.id}/vote`, { headers, data: { vote: "up" } });
    expect(voted.status()).toBe(201);
    expect(await voted.json()).toEqual({ vote: "up", upvotes: 1, votesLeft: 4 });

    await page.goto(`/@${maker.username}`);
    await expect(page.getByRole("link", { name, exact: true }).first()).toBeVisible();

    // Revoking cuts it off.
    await page.goto("/settings/api");
    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByRole("status")).toHaveText("Token revoked.");
    expect((await request.get("/api/v1/me", { headers })).status()).toBe(401);
  });

  test("the slopper CLI launches, posts and votes through the same API", async ({ seed, stack }) => {
    const maker = await seed.user("terminal");
    const rival = await seed.slop(await seed.user("rival"));
    const env = {
      SLOPPER_URL: stack.appUrl,
      SLOPPER_TOKEN: await seed.apiToken(maker),
      XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "slopper-e2e-")),
    };

    expect(await slopper(env, "whoami")).toMatchObject({ username: maker.username, votesLeft: 5 });
    const name = `CLI slop ${Date.now().toString(36)}`;
    const launched = await slopper(
      env,
      "launch",
      "--name",
      name,
      "--tagline",
      "Launched from a terminal",
      "--category",
      "ai",
      "--link",
      "https://cli.example/",
    );
    expect(launched).toMatchObject({ slop: { name, nsfw: false, hidden: false } });
    const slug = (launched.slop as { slug: string }).slug;
    expect(await slopper(env, "post", slug, "--kind", "feature", "--body", "Now with flags")).toMatchObject({
      update: { kind: "feature" },
    });

    // The race is shared by every test, so only the parts that are this test's.
    expect(await slopper(env, "today")).toMatchObject({ date: new Date().toISOString().slice(0, 10), votesLeft: 5 });
    expect(await slopper(env, "vote", rival.id, "up")).toEqual({ vote: "up", upvotes: 1, votesLeft: 4 });
  });

  test("agents search by meaning and words through REST, MCP and the CLI", async ({ seed, request, stack }) => {
    const finder = await seed.user("finder");
    const token = await seed.apiToken(finder);
    const headers = { authorization: `Bearer ${token}` };
    const maker = await seed.user("maker");
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const jar = await seed.slop(maker, { name: `Penny Jar ${id}`, tagline: "Track every expense", category: "money" });
    const maze = await seed.slop(maker, { name: `Marble Maze ${id}`, tagline: "Tilt to roll", category: "games" });
    const names = (body: unknown) => ((body as { results: { name: string }[] }).results ?? []).map((r) => r.name);

    // By meaning, once the launch's embedding is in (it's made just after).
    await expect
      .poll(async () => names(await (await request.get("/api/v1/search?q=budget", { headers })).json()))
      .toContain(jar.name);
    const found = (await (await request.get(`/api/v1/search?q=${id}&category=games`, { headers })).json()) as {
      query: string;
      results: { name: string }[];
    };
    expect(found.query).toBe(id);
    // Other tests' slops can match by meaning too, so only this test's.
    expect(found.results.filter((result) => result.name.endsWith(id))).toMatchObject([
      { id: maze.id, owner: maker.username, name: maze.name, category: "games", yours: false },
    ]);
    const unknown = await request.get(`/api/v1/search?q=${id}&category=nope`, { headers });
    expect(unknown.status()).toBe(400);
    expect(await unknown.json()).toMatchObject({
      error: "Unknown categories: nope. list_categories has the valid ones.",
    });

    const searched = await mcp(request, token, "tools/call", {
      name: "search_slops",
      arguments: { query: id, categories: ["money"] },
    });
    expect(names(searched.result?.structuredContent).filter((name) => name.endsWith(id))).toEqual([jar.name]);

    const env = {
      SLOPPER_URL: stack.appUrl,
      SLOPPER_TOKEN: token,
      XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "slopper-e2e-")),
    };
    expect(names(await slopper(env, "search", id, "--category", "games", "--category", "money"))).toEqual(
      expect.arrayContaining([jar.name, maze.name]),
    );
  });

  test("without a token, only what's public can be read", async ({ seed, request, stack }) => {
    expect((await request.get("/api/v1/me")).status()).toBe(401);
    expect((await request.get("/api/v1/slops")).status()).toBe(401);
    const response = await request.post("/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(response.status()).toBe(401);
    // A token that doesn't work is refused even where none is needed.
    const bad = await request.get("/api/v1/today", { headers: { authorization: "Bearer slp_not-a-real-token" } });
    expect(bad.status()).toBe(401);

    const maker = await seed.user("public");
    const goal = await request.post("/api/v1/goal", {
      headers: { authorization: `Bearer ${await seed.apiToken(maker)}` },
      data: { target: 7, days: 7 },
    });
    expect(goal.status()).toBe(201);
    const slop = await seed.slop(maker);

    const profile = await request.get(`/api/v1/users/${maker.username}`);
    expect(profile.status()).toBe(200);
    const body = (await profile.json()) as { goal: { board: { state: string }[] }; slops: { name: string }[] };
    expect(body).toMatchObject({
      username: maker.username,
      totalSlops: 1,
      streak: 1,
      goal: { target: 7, days: 7, shipped: 1, toGo: 6, currentDay: 1, status: "active" },
      slops: [{ name: slop.name }],
    });
    expect(body.goal.board.map((day) => day.state)).toEqual(["shipped", ...Array(6).fill("upcoming")]);
    expect((await request.get("/api/v1/users/nobody-is-called-this")).status()).toBe(404);
    expect((await (await request.get("/api/v1/today")).json()) as unknown).toMatchObject({ votesLeft: null });

    // The CLI reads it with no token at all.
    const env = { SLOPPER_URL: stack.appUrl, XDG_CONFIG_HOME: await mkdtemp(join(tmpdir(), "slopper-e2e-")) };
    expect(await slopper(env, "profile", `@${maker.username}`)).toMatchObject({
      username: maker.username,
      goal: { shipped: 1, toGo: 6 },
    });
  });

  test("every form offers a prompt to paste into an agent", async ({ seed, context, stack }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await seed.pageAs(await seed.user("lazy"));
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: stack.appUrl });
    for (const path of ["/new", "/goal"]) {
      await page.goto(path);
      await page.getByText("🤖 Pass it to your agent").click();
      await expect(page.locator("pre").first()).toContainText(`${stack.appUrl}/mcp`);
      await page.getByRole("button", { name: "Copy prompt" }).click();
      await expect(page.getByRole("button", { name: "Copied ✓" })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(stack.appUrl);
    }
  });
});
