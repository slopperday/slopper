import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { type Io, main } from "../src/main.ts";

interface Call {
  method: string;
  url: string;
  authorization: string | null;
  contentType: string | null;
  body: unknown;
}

type Reply = { status?: number; body: unknown };

/** A slopper.day stand-in: answers by "METHOD /path", records every call. */
async function harness(routes: Record<string, Reply> = {}, env: Record<string, string> = {}) {
  const home = await mkdtemp(join(tmpdir(), "slopper-cli-"));
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let stdin: string | null = null;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const raw = init?.body;
    calls.push({
      method,
      url: url.href,
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
      body: typeof raw === "string" ? JSON.parse(raw) : raw instanceof Uint8Array ? [...raw] : null,
    });
    const reply = routes[`${method} ${url.pathname}`] ?? { status: 404, body: { error: "No route." } };
    return Response.json(reply.body, { status: reply.status ?? 200 });
  };
  const io: Io = {
    env: { XDG_CONFIG_HOME: join(home, ".config"), ...env },
    home,
    fetch: fakeFetch,
    readStdin: async () => stdin,
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
  };
  return {
    home,
    calls,
    configFile: join(home, ".config", "slopper", "config.json"),
    pipe(text: string) {
      stdin = text;
    },
    async run(...argv: string[]) {
      out.length = 0;
      err.length = 0;
      const code = await main(argv, io);
      return { code, stdout: out.join(""), stderr: err.join("") };
    },
  };
}

const TOKEN = { SLOPPER_TOKEN: "slp_test" };

describe("slopper", () => {
  it("lists every command, and each command's flags", async () => {
    const cli = await harness();
    const overview = await cli.run("help");
    expect(overview.code).toBe(0);
    for (const name of ["login", "whoami", "today", "launch", "post", "money", "vote", "skill"]) {
      expect(overview.stdout).toContain(`\n  ${name} `);
    }
    expect((await cli.run("launch", "--help")).stdout).toContain("--screenshot <file|id>");
    expect((await cli.run("help", "vote")).stdout).toContain("Usage: slopper vote <slop> <up|down|clear>");
    expect(cli.calls).toEqual([]);
  });

  it("calls usage mistakes exit code 2 and API failures 1", async () => {
    const cli = await harness({}, TOKEN);
    expect(await cli.run("nope")).toMatchObject({ code: 2, stderr: expect.stringContaining("Unknown command") });
    expect(await cli.run("whoami", "--bogus")).toMatchObject({ code: 2, stderr: expect.stringContaining("--bogus") });
    expect(await cli.run("vote", "abc", "sideways")).toMatchObject({ code: 2 });
    expect(await cli.run("money", "tiltmaze", "cost", "free")).toMatchObject({ code: 2 });
    expect(cli.calls).toEqual([]);
    expect(await cli.run("whoami")).toEqual({ code: 1, stdout: "", stderr: "slopper: No route.\n" });
  });

  it("asks for a token before calling the API", async () => {
    const cli = await harness();
    const result = await cli.run("whoami");
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("https://slopper.day/settings/api");
    expect(cli.calls).toEqual([]);
  });

  it("checks a token, saves it for its owner only, then uses it", async () => {
    const cli = await harness({ "GET /api/v1/me": { body: { username: "maker" } } });
    cli.pipe("slp_piped\n");
    expect(JSON.parse((await cli.run("login")).stdout)).toEqual({
      loggedIn: "maker",
      url: "https://slopper.day",
      config: cli.configFile,
    });
    expect(JSON.parse(await readFile(cli.configFile, "utf8"))).toEqual({ token: "slp_piped" });
    expect((await stat(cli.configFile)).mode & 0o777).toBe(0o600);

    await cli.run("whoami");
    expect(cli.calls.map((call) => [call.url, call.authorization])).toEqual([
      ["https://slopper.day/api/v1/me", "Bearer slp_piped"],
      ["https://slopper.day/api/v1/me", "Bearer slp_piped"],
    ]);

    await cli.run("logout");
    expect(await cli.run("whoami")).toMatchObject({ code: 1, stderr: expect.stringContaining("No API token") });
  });

  it("saves a site passed to login, and flags beat the environment", async () => {
    const cli = await harness({ "GET /api/v1/me": { body: { username: "local" } } }, { SLOPPER_TOKEN: "slp_env" });
    await cli.run("login", "--token", "slp_local", "--url", "http://localhost:5173/anything");
    expect(JSON.parse(await readFile(cli.configFile, "utf8"))).toEqual({
      token: "slp_local",
      url: "http://localhost:5173",
    });
    await cli.run("today");
    await cli.run("today", "--token", "slp_flag", "--url", "https://staging.slopper.day");
    expect(cli.calls.slice(1).map((call) => [call.url, call.authorization])).toEqual([
      ["http://localhost:5173/api/v1/today", "Bearer slp_env"],
      ["https://staging.slopper.day/api/v1/today", "Bearer slp_flag"],
    ]);
  });

  it("launches with uploaded screenshot files, media ids and parsed links", async () => {
    const cli = await harness(
      {
        "POST /api/v1/media": { status: 201, body: { id: "media_file", url: "https://cdn/x.png", contentCheck: "ok" } },
        "POST /api/v1/slops": { status: 201, body: { slop: { id: "slop_1" }, contentCheck: "ok" } },
      },
      TOKEN,
    );
    const cover = join(cli.home, "cover.png");
    await writeFile(cover, new Uint8Array([137, 80, 78, 71]));

    const result = await cli.run(
      "launch",
      "--name",
      "TiltMaze",
      "--tagline",
      "Tilt to play",
      "--category",
      "games",
      "--link",
      "https://tiltmaze.app",
      "--link",
      "testflight=https://testflight.apple.com/join/abc",
      "--screenshot",
      cover,
      "--screenshot",
      "media_existing",
      "--made-with",
      "Flutter",
      "--autopost",
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ slop: { id: "slop_1" }, contentCheck: "ok" });
    const [upload, launch] = cli.calls;
    expect(upload).toMatchObject({ method: "POST", contentType: "image/png", body: [137, 80, 78, 71] });
    expect(launch.body).toEqual({
      name: "TiltMaze",
      tagline: "Tilt to play",
      category: "games",
      links: [
        { kind: "website", url: "https://tiltmaze.app" },
        { kind: "testflight", url: "https://testflight.apple.com/join/abc" },
      ],
      screenshots: ["media_file", "media_existing"],
      madeWith: ["Flutter"],
      autopost: true,
    });
  });

  it("refuses screenshot files it can't read or send", async () => {
    const cli = await harness({}, TOKEN);
    const missing = await cli.run("launch", "--name", "X", "--screenshot", "./nowhere/shot.png");
    expect(missing).toMatchObject({ code: 2, stderr: "slopper: Couldn't read ./nowhere/shot.png.\n" });
    const pdf = await cli.run("upload", "deck.pdf");
    expect(pdf).toMatchObject({ code: 2, stderr: "slopper: deck.pdf isn't a PNG, JPEG, WebP or GIF.\n" });
    expect(cli.calls).toEqual([]);
  });

  it("edits only what's passed, and posts, logs money and votes on the right routes", async () => {
    const ok = { status: 201, body: {} };
    const cli = await harness(
      {
        "PATCH /api/v1/slops/my%20slop": { body: {} },
        "POST /api/v1/slops/tiltmaze/updates": ok,
        "POST /api/v1/slops/tiltmaze/money": ok,
        "POST /api/v1/slops/abc123/vote": ok,
        "POST /api/v1/goal": ok,
      },
      TOKEN,
    );
    await cli.run("edit", "my slop", "--tagline", "Sharper");
    await cli.run("post", "tiltmaze", "--body", "Fixed the timer");
    await cli.run("money", "tiltmaze", "revenue", "4.99", "--currency", "EUR");
    await cli.run("vote", "abc123", "down");
    await cli.run("goal", "--days", "30", "--target", "15");
    expect(cli.calls.map((call) => [call.method, new URL(call.url).pathname, call.body])).toEqual([
      ["PATCH", "/api/v1/slops/my%20slop", { tagline: "Sharper" }],
      ["POST", "/api/v1/slops/tiltmaze/updates", { kind: "update", body: "Fixed the timer", autopost: false }],
      ["POST", "/api/v1/slops/tiltmaze/money", { kind: "revenue", amount: 4.99, currency: "EUR" }],
      ["POST", "/api/v1/slops/abc123/vote", { vote: "down" }],
      ["POST", "/api/v1/goal", { target: 15, days: 30 }],
    ]);
  });

  it("prints validation problems field by field", async () => {
    const cli = await harness(
      {
        "POST /api/v1/slops": {
          status: 422,
          body: { error: "The slop needs fixing.", details: { tagline: "Say what it does." } },
        },
      },
      TOKEN,
    );
    expect(await cli.run("launch", "--name", "TiltMaze")).toEqual({
      code: 1,
      stdout: "",
      stderr: "slopper: The slop needs fixing.\n  tagline: Say what it does.\n",
    });
  });

  it("prints the skill and installs it where agents look", async () => {
    const cli = await harness();
    const printed = await cli.run("skill");
    expect(printed.stdout).toMatch(/^---\nname: slopper\n/);
    const installed = await cli.run("skill", "install");
    const path = join(cli.home, ".agents", "skills", "slopper", "SKILL.md");
    expect(JSON.parse(installed.stdout)).toEqual({ installed: path });
    expect(await readFile(path, "utf8")).toBe(printed.stdout);
    expect((await cli.run("skill", "uninstall")).code).toBe(2);
  });
});
