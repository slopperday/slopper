import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { api } from "../convex/_generated/api.js";
import { bucketObjects, expect, test } from "./fixtures.ts";

/**
 * An agent's day with the built CLI, the single file npm ships
 * (packages/cli/dist), run as a child process against the e2e stack. Each
 * agent gets its own home, so the only config it reads is the one it saved.
 */

let bin: string;

test.beforeAll(async () => {
  // Built per worker into a directory of its own, so parallel workers don't race on dist/.
  const outDir = await mkdtemp(join(tmpdir(), "slopper-cli-e2e-"));
  execFileSync("node_modules/.bin/vp", ["pack", "--out-dir", outDir], { cwd: "packages/cli", stdio: "ignore" });
  bin = join(outDir, "slopper.mjs");
});

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the CLI through its shebang with only PATH, HOME and what the test adds: nothing of this machine's. */
function slopper(home: string, args: string[], env: Record<string, string> = {}): Promise<Run> {
  return new Promise((done) => {
    execFile(
      bin,
      args,
      { cwd: home, env: { PATH: process.env.PATH ?? "", HOME: home, ...env } },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        done({ code, stdout, stderr });
      },
    );
  });
}

async function json(run: Promise<Run>): Promise<Record<string, unknown>> {
  const result = await run;
  expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

test.describe("agents run the slopper CLI", () => {
  test("log in with a token, launch with a screenshot, find it, post and vote", async ({ seed, stack, convex }) => {
    const maker = await seed.user("cli");
    const rival = await seed.slop(await seed.user("rival"));
    const token = await seed.apiToken(maker);
    const home = await mkdtemp(join(tmpdir(), "slopper-agent-"));
    const config = join(home, ".config", "slopper", "config.json");

    expect(await json(slopper(home, ["login", "--token", token, "--url", stack.appUrl]))).toEqual({
      loggedIn: maker.username,
      url: stack.appUrl,
      config,
    });
    expect((await stat(config)).mode & 0o777).toBe(0o600);
    // Everything after login comes from the saved config: no flags, no environment.
    expect(await json(slopper(home, ["whoami"]))).toMatchObject({
      username: maker.username,
      timeZone: "UTC",
      votesLeft: 5,
      goal: null,
    });

    // A real PNG, unique to this test, for the bucket to hold.
    const id = Date.now().toString(36);
    const shotPage = await seed.visitorPage();
    await shotPage.setContent(`<h1 style="font: 48px sans-serif">CLI shot ${id}</h1>`);
    const shot = await shotPage.screenshot({ clip: { x: 0, y: 0, width: 480, height: 240 } });
    const file = join(home, "cover.png");
    await writeFile(file, shot);

    const name = `CLI slop ${id}`;
    const launched = await json(
      slopper(home, [
        "launch",
        "--name",
        name,
        "--tagline",
        "Launched by the built CLI",
        "--category",
        "ai",
        "--link",
        "https://cli.example/",
        "--screenshot",
        file,
        "--made-with",
        "slopper",
      ]),
    );
    expect(launched).toMatchObject({ slop: { name, upvotes: 0 }, contentCheck: "ok" });
    const slop = launched.slop as { id: string; slug: string; url: string };
    const stored = (await bucketObjects(stack)).find(
      (object) => object.sha256 === createHash("sha256").update(shot).digest("hex"),
    );
    expect(stored).toMatchObject({ contentType: "image/png" });

    const mine = (await json(slopper(home, ["slops"]))).slops as { id: string; slug: string }[];
    expect(mine).toEqual([expect.objectContaining({ id: slop.id, slug: slop.slug })]);
    expect(
      await json(slopper(home, ["post", slop.slug, "--kind", "feature", "--body", `Flags arrived ${id}`])),
    ).toMatchObject({
      update: { kind: "feature" },
    });

    // The race is shared by every test, so only this test's slops.
    const race = (await json(slopper(home, ["today"]))).ranking as { id: string; yours: boolean }[];
    expect(race.find((entry) => entry.id === slop.id)).toMatchObject({ yours: true });
    expect(race.find((entry) => entry.id === rival.id)).toMatchObject({ yours: false });
    expect(await json(slopper(home, ["vote", rival.id, "up"]))).toEqual({ vote: "up", upvotes: 1, votesLeft: 4 });
    expect(await slopper(home, ["vote", slop.id, "up"])).toEqual({
      code: 1,
      stdout: "",
      stderr: "slopper: You can't vote on your own slop.\n",
    });
    expect((await convex.query(api.slops.getForServer, { slopId: rival.id }))?.upvotes).toBe(1);

    // The site shows what the CLI did.
    const page = await seed.visitorPage();
    await page.goto(new URL(slop.url).pathname);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(name);
    await expect(page.getByRole("img", { name: `${name} screenshot 1` })).toHaveAttribute(
      "src",
      `${stack.mediaUrl}/${stored?.key}`,
    );
    await expect(page.getByText(`Flags arrived ${id}`)).toBeVisible();

    expect(await json(slopper(home, ["logout"]))).toEqual({ loggedOut: true, config });
    expect(await slopper(home, ["whoami"])).toMatchObject({ code: 1, stderr: expect.stringContaining("No API token") });
  });

  test("run the commands the API page and llms.txt hand them", async ({ seed, stack, request }) => {
    const maker = await seed.user("pasted");
    const page = await seed.pageAs(maker);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/settings/api");
    await page.getByLabel("Token name").fill("An agent's terminal");
    await page.getByRole("button", { name: "Create token" }).click();
    // Masked on screen like the token, and pointed at this site, not slopper.day.
    const login = /^npx -y @slopperday\/cli login --token (slp_\S+) --url (\S+)$/;
    const shown = page.locator("pre").filter({ hasText: "@slopperday/cli login" });
    await expect(shown).toHaveText(new RegExp(`--token slp_•+ --url ${stack.appUrl}`));

    /** What a snippet's Copy button puts on the clipboard. */
    const copy = async (label: string) => {
      await page.getByText(label, { exact: true }).locator("..").getByRole("button", { name: "Copy" }).click();
      return await page.evaluate(() => navigator.clipboard.readText());
    };
    const copied = await copy("CLI, for agents with a terminal");
    const [, token, url] = login.exec(copied) ?? [];
    expect(url).toBe(stack.appUrl);
    const home = await mkdtemp(join(tmpdir(), "slopper-agent-"));
    expect(await json(slopper(home, ["login", "--token", token, "--url", url]))).toMatchObject({
      loggedIn: maker.username,
    });

    // The other snippet passes the token in the environment and saves nothing.
    const envOnly = await copy("CLI, without saving the token");
    expect(envOnly).toBe(`SLOPPER_TOKEN=${token} SLOPPER_URL=${stack.appUrl} npx -y @slopperday/cli whoami`);
    const fresh = await mkdtemp(join(tmpdir(), "slopper-agent-"));
    expect(await json(slopper(fresh, ["whoami"], { SLOPPER_TOKEN: token, SLOPPER_URL: url }))).toMatchObject({
      username: maker.username,
    });
    await expect(stat(join(fresh, ".config"))).rejects.toMatchObject({ code: "ENOENT" });

    // llms.txt names every runner, and the flags agents need with them.
    const guide = await (await request.get("/llms.txt")).text();
    for (const runner of [
      "npx -y @slopperday/cli <command>",
      "pnpm dlx @slopperday/cli <command>",
      "bunx @slopperday/cli <command>",
      "yarn dlx -q @slopperday/cli <command>",
      "deno run -A npm:@slopperday/cli <command>",
      "npm i -g @slopperday/cli",
      `slopper login --token slp_... --url ${stack.appUrl}`,
      `SLOPPER_TOKEN=slp_... SLOPPER_URL=${stack.appUrl} slopper whoami`,
    ]) {
      expect(guide).toContain(runner);
    }
  });

  test("use SLOPPER_TOKEN without saving it, and are told what's wrong", async ({ seed, stack }) => {
    const maker = await seed.user("envonly");
    const home = await mkdtemp(join(tmpdir(), "slopper-agent-"));
    const env = { SLOPPER_TOKEN: await seed.apiToken(maker), SLOPPER_URL: stack.appUrl };

    expect(await json(slopper(home, ["whoami"], env))).toMatchObject({ username: maker.username });
    const invalid = await slopper(home, ["launch", "--name", "No tagline"], env);
    expect(invalid).toMatchObject({ code: 1, stdout: "" });
    expect(invalid.stderr).toMatch(/^slopper: The slop needs fixing\.\n {2}\w+: .+\n/);

    const refused = await slopper(home, ["login", "--token", "slp_not-a-real-token", "--url", stack.appUrl]);
    expect(refused).toMatchObject({ code: 1, stdout: "" });
    expect(refused.stderr).toContain("Missing or invalid API token.");
    // Neither the environment's token nor the refused one was written down.
    await expect(stat(join(home, ".config", "slopper"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
