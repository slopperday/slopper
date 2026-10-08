import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

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
    const token = (await page.locator("code").first().textContent())?.trim() ?? "";
    expect(token.length).toBeGreaterThan(20);
    // The connection snippets carry it.
    await expect(page.getByText(`Authorization: Bearer ${token}`).first()).toBeVisible();

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
    const body = (await created.json()) as { contentCheck: string; autopost: unknown; slop: { url: string } };
    expect(body.contentCheck).toBe("ok");
    // Nothing is connected, so nothing went out.
    expect(body.autopost).toEqual({ status: "posted", results: [] });

    const invalid = await request.post("/api/v1/slops", { headers, data: { name: "No tagline" } });
    expect(invalid.status()).toBe(422);

    // MCP: same operations, JSON-RPC.
    const tools = await mcp(request, token, "tools/list");
    const names = ((tools.result?.tools ?? []) as { name: string }[]).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["create_slop", "post_update", "todays_race", "set_goal"]));
    const mine = await mcp(request, token, "tools/call", { name: "list_my_slops", arguments: {} });
    expect(mine.result?.isError).toBe(false);
    expect(JSON.stringify(mine.result?.structuredContent)).toContain(name);
    // Comments are off: no feedback counts for agents either.
    expect(JSON.stringify(mine.result?.structuredContent)).not.toContain('"feedback"');
    const race = await mcp(request, token, "tools/call", { name: "todays_race", arguments: {} });
    expect(race.result?.structuredContent).toMatchObject({ date: new Date().toISOString().slice(0, 10) });

    await page.goto(`/@${maker.username}`);
    await expect(page.getByRole("link", { name, exact: true }).first()).toBeVisible();

    // Revoking cuts it off.
    await page.goto("/settings/api");
    await page.getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByRole("status")).toHaveText("Token revoked.");
    expect((await request.get("/api/v1/me", { headers })).status()).toBe(401);
  });

  test("calls without a token are refused", async ({ request }) => {
    expect((await request.get("/api/v1/me")).status()).toBe(401);
    const response = await request.post("/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
    expect(response.status()).toBe(401);
  });

  test("every form offers a prompt to paste into an agent", async ({ seed, context, stack }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await seed.pageAs(await seed.user("lazy"));
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: stack.appUrl });
    for (const path of ["/new", "/goal"]) {
      await page.goto(path);
      await page.getByText("🤖 Let your AI do it").click();
      await expect(page.locator("pre").first()).toContainText(`${stack.appUrl}/mcp`);
      await page.getByRole("button", { name: "Copy prompt" }).click();
      await expect(page.getByRole("button", { name: "Copied ✓" })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(stack.appUrl);
    }
  });
});
