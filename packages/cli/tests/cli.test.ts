import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { LIMITS } from "../../../app/lib/model.ts";
import manifest from "../package.json" with { type: "json" };
import { COMMANDS, MEDIA_BYTES, VIDEO_BYTES } from "../src/commands.ts";
import { type Io, main } from "../src/main.ts";

interface Call {
  method: string;
  url: string;
  authorization: string | null;
  contentType: string | null;
  accept: string | null;
  userAgent: string | null;
  body: unknown;
}

/** A JSON reply, or a hand-made response for bodies that aren't JSON. Throwing stands for the network failing. */
type Reply = { status?: number; body: unknown } | (() => Response);

/**
 * A slopper.day stand-in: answers by "METHOD /path", records every call. A
 * list of replies answers in turn, repeating the last, like a sign-in that's
 * pending until it's approved.
 */
async function harness(
  routes: Record<string, Reply | Reply[]> = {},
  env: Record<string, string> = {},
  realFetch?: typeof fetch,
) {
  const home = await mkdtemp(join(tmpdir(), "slopper-cli-"));
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let stdin: string | null = null;
  const opened: string[] = [];
  const slept: number[] = [];
  let browser = true;
  const asked = new Map<string, number>();
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
      accept: headers.get("accept"),
      userAgent: headers.get("user-agent"),
      body: typeof raw === "string" ? JSON.parse(raw) : raw instanceof Uint8Array ? [...raw] : null,
    });
    const key = `${method} ${url.pathname}`;
    const route = routes[key] ?? { status: 404, body: { error: "No route." } };
    const turn = asked.get(key) ?? 0;
    asked.set(key, turn + 1);
    const reply = Array.isArray(route) ? route[Math.min(turn, route.length - 1)] : route;
    if (typeof reply === "function") return reply();
    return Response.json(reply.body, { status: reply.status ?? 200 });
  };
  const io: Io = {
    env: { XDG_CONFIG_HOME: join(home, ".config"), ...env },
    home,
    hostname: "studio",
    fetch: realFetch ?? fakeFetch,
    readStdin: async () => stdin,
    openUrl: async (url) => {
      opened.push(url);
      return browser;
    },
    sleep: async (ms) => void slept.push(ms),
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
  };
  return {
    home,
    calls,
    /** Pages the CLI opened in the browser. */
    opened,
    /** Every wait between polls, in ms. */
    slept,
    configFile: join(home, ".config", "slopper", "config.json"),
    pipe(text: string) {
      stdin = text;
    },
    /** Makes opening the browser fail, as on a machine without one. */
    noBrowser() {
      browser = false;
    },
    /** Writes a config as `slopper login` (or a person with an editor) would have. */
    async save(text: string, mode = 0o600) {
      await mkdir(join(home, ".config", "slopper"), { recursive: true });
      await writeFile(join(home, ".config", "slopper", "config.json"), text, { mode });
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
const USER_AGENT = `slopper-cli/${manifest.version}`;

/** What a usage mistake prints: the problem, then where to read up. */
function usage(command: string | null, message: string): string {
  const hint = command ? `Run \`slopper help ${command}\`.` : "Run `slopper help` for the commands.";
  return `slopper: ${message}\n${hint}\n`;
}

/** A port nothing listens on: bound once, then let go. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("No port.");
  await new Promise<void>((done) => server.close(() => done()));
  return address.port;
}

describe("help", () => {
  it("lists every command and the global flags, however it's asked for", async () => {
    const cli = await harness();
    const overview = await cli.run("help");
    expect(overview.code).toBe(0);
    expect(overview.stdout).toMatch(new RegExp(`^slopper ${manifest.version.replaceAll(".", "\\.")}: `));
    for (const command of COMMANDS) expect(overview.stdout).toContain(`\n  ${command.name} `);
    for (const flag of ["--token <token>", "--url <url>", "-h, --help", "SLOPPER_TOKEN"]) {
      expect(overview.stdout).toContain(flag);
    }
    for (const argv of [[], ["--help"], ["-h"]]) expect(await cli.run(...argv)).toEqual(overview);
    expect(cli.calls).toEqual([]);
  });

  it.each(COMMANDS.map((command) => command.name))("explains %s, with help, --help or -h", async (name) => {
    const cli = await harness();
    const command = COMMANDS.find((candidate) => candidate.name === name);
    const help = await cli.run("help", name);
    expect(help.code).toBe(0);
    expect(help.stdout).toMatch(new RegExp(`^Usage: slopper ${name}[ \\n]`));
    expect(help.stdout).toContain(command?.summary);
    for (const flag of Object.keys(command?.flags ?? {})) expect(help.stdout).toContain(`  ${flag}  `);
    expect(help.stdout).toContain("Global flags:");
    expect(await cli.run(name, "--help")).toEqual(help);
    expect(await cli.run(name, "-h")).toEqual(help);
    // Help needs no token and never calls the site.
    expect(cli.calls).toEqual([]);
  });

  it("prints the version from package.json", async () => {
    const cli = await harness();
    expect(await cli.run("--version")).toEqual({ code: 0, stdout: `${manifest.version}\n`, stderr: "" });
    expect(await cli.run("-v")).toEqual({ code: 0, stdout: `${manifest.version}\n`, stderr: "" });
  });

  it("calls an unknown command, or flags before the command, a usage mistake", async () => {
    const cli = await harness({}, TOKEN);
    expect(await cli.run("nope")).toEqual({ code: 2, stdout: "", stderr: usage(null, "Unknown command “nope”.") });
    expect(await cli.run("help", "nope")).toMatchObject({ code: 2, stderr: usage(null, "Unknown command “nope”.") });
    expect(await cli.run("--url", "http://localhost:5173", "whoami")).toEqual({
      code: 2,
      stdout: "",
      stderr: usage(null, "Put the command first, then its flags: slopper <command> --url …"),
    });
    expect(cli.calls).toEqual([]);
  });
});

/** Every command's REST call, with the flags it maps onto JSON. */
const ROUTE_CASES: { name: string; argv: string[]; method: string; path: string; body: unknown }[] = [
  { name: "whoami", argv: ["whoami"], method: "GET", path: "/api/v1/me", body: null },
  { name: "today", argv: ["today"], method: "GET", path: "/api/v1/today", body: null },
  { name: "categories", argv: ["categories"], method: "GET", path: "/api/v1/categories", body: null },
  { name: "slops", argv: ["slops"], method: "GET", path: "/api/v1/slops", body: null },
  { name: "scheduled", argv: ["scheduled"], method: "GET", path: "/api/v1/scheduled", body: null },
  {
    name: "goal",
    argv: ["goal", "--target", "15", "--days", "30", "--start", "2026-10-20", "--title", "Fifteen in thirty"],
    method: "POST",
    path: "/api/v1/goal",
    body: { target: 15, days: 30, startDate: "2026-10-20", title: "Fifteen in thirty" },
  },
  {
    name: "launch",
    argv: [
      "launch",
      "--name",
      "TiltMaze",
      "--tagline",
      "Tilt to play",
      "--description",
      "Built in a **day**.",
      "--category",
      "games",
      "--link",
      "https://tiltmaze.app/?level=2",
      "--link",
      "source=https://github.com/maker/tiltmaze",
      "--made-with",
      "Flutter",
      "--made-with",
      "Claude",
      "--note",
      "Day 12: a maze you tilt.",
      "--relaunch-of",
      "tiltmaze",
      "--label",
      "iOS app",
      "--at",
      "2026-10-20T09:00",
      "--autopost",
    ],
    method: "POST",
    path: "/api/v1/slops",
    body: {
      name: "TiltMaze",
      tagline: "Tilt to play",
      description: "Built in a **day**.",
      category: "games",
      links: [
        { kind: "website", url: "https://tiltmaze.app/?level=2" },
        { kind: "source", url: "https://github.com/maker/tiltmaze" },
      ],
      madeWith: ["Flutter", "Claude"],
      launchNote: "Day 12: a maze you tilt.",
      relaunchOf: "tiltmaze",
      launchLabel: "iOS app",
      releaseAt: "2026-10-20T09:00",
      autopost: true,
    },
  },
  {
    name: "release",
    argv: ["release", "sched/1"],
    method: "POST",
    path: "/api/v1/scheduled/sched%2F1/release",
    body: {},
  },
  {
    name: "unschedule",
    argv: ["unschedule", "sched_2"],
    method: "DELETE",
    path: "/api/v1/scheduled/sched_2",
    body: null,
  },
  {
    name: "edit",
    argv: [
      "edit",
      "my slop",
      "--name",
      "TiltMaze 2",
      "--description",
      "Now with levels.",
      "--category",
      "games",
      "--link",
      "website=https://tiltmaze.app",
      "--made-with",
      "Rust",
    ],
    method: "PATCH",
    path: "/api/v1/slops/my%20slop",
    body: {
      name: "TiltMaze 2",
      description: "Now with levels.",
      category: "games",
      links: [{ kind: "website", url: "https://tiltmaze.app" }],
      madeWith: ["Rust"],
    },
  },
  {
    name: "post",
    argv: ["post", "tiltmaze", "--kind", "field", "--body", "Five people tried it at the bus stop.", "--autopost"],
    method: "POST",
    path: "/api/v1/slops/tiltmaze/updates",
    body: { kind: "field", body: "Five people tried it at the bus stop.", autopost: true },
  },
  {
    name: "money",
    argv: ["money", "tiltmaze", "cost", "12.99", "--currency", "EUR", "--category", "domain", "--note", "tiltmaze.app"],
    method: "POST",
    path: "/api/v1/slops/tiltmaze/money",
    body: { kind: "cost", amount: 12.99, currency: "EUR", category: "domain", note: "tiltmaze.app" },
  },
  {
    name: "money",
    argv: ["money", "tiltmaze", "revenue", "5", "--date", "2026-10-17"],
    method: "POST",
    path: "/api/v1/slops/tiltmaze/money",
    body: { kind: "revenue", amount: 5, date: "2026-10-17" },
  },
  ...(["up", "down", "clear"] as const).map((vote) => ({
    name: "vote",
    argv: ["vote", "abc123", vote],
    method: "POST",
    path: "/api/v1/slops/abc123/vote",
    body: { vote },
  })),
];

/** Commands with tests of their own below: they read files, stdin or the config. */
const OWN_TESTS = ["login", "logout", "upload", "skill", "video"];

describe("every command", () => {
  it("has a route case or tests of its own", () => {
    const covered = new Set([...ROUTE_CASES.map((route) => route.name), ...OWN_TESTS]);
    expect(COMMANDS.map((command) => command.name).filter((name) => !covered.has(name))).toEqual([]);
  });

  it.each(ROUTE_CASES)("$name calls $method $path and prints its JSON", async ({ argv, method, path, body }) => {
    const reply = { ok: true, from: path, list: [1, { nested: "yes" }] };
    const cli = await harness({ [`${method} ${path}`]: { status: method === "POST" ? 201 : 200, body: reply } }, TOKEN);
    expect(await cli.run(...argv)).toEqual({ code: 0, stdout: `${JSON.stringify(reply, null, 2)}\n`, stderr: "" });
    expect(cli.calls).toEqual([
      {
        method,
        url: `https://slopper.day${path}`,
        authorization: "Bearer slp_test",
        contentType: body === null ? null : "application/json",
        accept: "application/json",
        userAgent: USER_AGENT,
        body,
      },
    ]);
  });

  it("edits only what's passed", async () => {
    const cli = await harness({ "PATCH /api/v1/slops/tiltmaze": { body: {} } }, TOKEN);
    await cli.run("edit", "tiltmaze", "--tagline", "Sharper");
    expect(cli.calls.map((call) => call.body)).toEqual([{ tagline: "Sharper" }]);
  });

  it("posts plain updates without auto-posting unless asked", async () => {
    const cli = await harness({ "POST /api/v1/slops/tiltmaze/updates": { status: 201, body: {} } }, TOKEN);
    await cli.run("post", "tiltmaze", "--body", "Fixed the timer");
    expect(cli.calls.map((call) => call.body)).toEqual([{ kind: "update", body: "Fixed the timer", autopost: false }]);
  });

  it("schedules a launch for the next free day", async () => {
    const cli = await harness({ "POST /api/v1/slops": { status: 201, body: {} } }, TOKEN);
    await cli.run("launch", "--name", "TiltMaze", "--at", "next");
    expect(cli.calls.map((call) => call.body)).toEqual([{ name: "TiltMaze", releaseAt: "next", autopost: false }]);
  });
});

describe("usage mistakes", () => {
  const CASES: [string[], string][] = [
    [["whoami", "--bogus"], "Unknown option '--bogus'."],
    [["whoami", "extra"], "Unexpected “extra”. Usage: slopper whoami"],
    [["vote"], "Missing <slop>."],
    [["vote", "abc"], "Missing <up|down|clear>."],
    [["vote", "abc", "sideways"], "A vote is up, down or clear, not “sideways”."],
    [["vote", "abc", "up", "now"], "Unexpected “now”. Usage: slopper vote <slop> <up|down|clear>"],
    [["money"], "Missing <slop>."],
    [["money", "tiltmaze"], "Missing <cost|revenue>."],
    [["money", "tiltmaze", "cost"], "Missing <amount>."],
    [["money", "tiltmaze", "gift", "5"], "Money is a cost or revenue, not “gift”."],
    [["money", "tiltmaze", "cost", "free"], "<amount> must be a number above zero, like 12.99, not “free”."],
    [["money", "tiltmaze", "cost", "0"], "<amount> must be a number above zero, like 12.99, not “0”."],
    [["money", "tiltmaze", "cost", "12,99"], "<amount> must be a number above zero, like 12.99, not “12,99”."],
    [["money", "tiltmaze", "cost", "0x10"], "<amount> must be a number above zero, like 12.99, not “0x10”."],
    [["money", "tiltmaze", "cost", "-5"], "Unknown option '-5'."],
    [["post"], "Missing <slop>."],
    [["post", "tiltmaze"], "Missing --body <markdown>."],
    [["post", "tiltmaze", "Fixed the timer"], "Unexpected “Fixed the timer”. Usage: slopper post <slop> [flags]"],
    [["edit"], "Missing <slop>."],
    [["edit", "tiltmaze"], "Nothing to change: pass a flag, like --tagline."],
    [["edit", "tiltmaze", "Sharper"], "Unexpected “Sharper”. Usage: slopper edit <slop> [flags]"],
    [["release"], "Missing <scheduled>."],
    [["unschedule"], "Missing <scheduled>."],
    [["upload"], "Missing <image>."],
    [["goal"], "Missing --target <n>."],
    [["goal", "--target", "5"], "Missing --days <n>."],
    [["goal", "--target", "five", "--days", "7"], "--target must be a whole number, not “five”."],
    [["goal", "--target", "5", "--days", "7.5"], "--days must be a whole number, not “7.5”."],
    [["goal", "--target", "5", "--days", ""], "--days must be a whole number, not “”."],
    [["goal", "--target", "Infinity", "--days", "7"], "--target must be a whole number, not “Infinity”."],
    [["launch", "--name"], "Option '--name <value>' argument missing"],
    [["launch", "--autopost=yes"], "Option '--autopost' does not take an argument"],
    [["launch", "--link", "tiltmaze.app"], "--link takes kind=url (website=https://…, testflight=https://…)"],
    // Markdown lists start with a dash, which reads as a flag; the error says to use --description=-…
    [["launch", "--description", "- one\n- two"], "To specify an option argument starting with a dash use"],
    [["skill", "uninstall"], "Unknown skill action “uninstall”. Try `slopper skill install`."],
    [["whoami", "--url", "slopper.day"], "slopper.day isn't a URL. Pass the site's address, like https://slopper.day."],
    [["whoami", "--url", "ftp://slopper.day"], "ftp://slopper.day isn't an http(s) URL."],
    [["whoami", "--url", "localhost:5173"], "localhost:5173 isn't an http(s) URL."],
  ];

  it.each(CASES)("%j exits 2 before calling the site", async (argv, message) => {
    const cli = await harness({}, TOKEN);
    const result = await cli.run(...argv);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^slopper: /);
    expect(result.stderr).toContain(message);
    expect(result.stderr.endsWith(`\nRun \`slopper help ${argv[0]}\`.\n`)).toBe(true);
    expect(cli.calls).toEqual([]);
  });
});

describe("server errors", () => {
  const html = (status: number) => () =>
    new Response("<html><body>Bad gateway</body></html>", { status, headers: { "content-type": "text/html" } });
  const CASES: [string, Reply, string][] = [
    [
      "401, a bad token",
      { status: 401, body: { error: "Missing or invalid API token. Create one at https://slopper.day/settings/api" } },
      "Missing or invalid API token. Create one at https://slopper.day/settings/api",
    ],
    ["403", { status: 403, body: { error: "That slop isn't yours." } }, "That slop isn't yours."],
    [
      "404",
      { status: 404, body: { error: "No slop of yours matches “x”.", details: null } },
      "No slop of yours matches “x”.",
    ],
    ["409", { status: 409, body: { error: "A goal is already open." } }, "A goal is already open."],
    ["429", { status: 429, body: { error: "Rate limit reached." } }, "Rate limit reached."],
    ["500 without an error field", { status: 500, body: { message: "boom" } }, "GET /me failed with HTTP 500."],
    ["502 with an HTML page", html(502), "GET /me failed with HTTP 502."],
    ["503 with an empty body", () => new Response(null, { status: 503 }), "GET /me failed with HTTP 503."],
    [
      "200 from a site that isn't Slopper",
      html(200),
      "https://slopper.day answered GET /me without JSON. Is it a Slopper site?",
    ],
    [
      "200 with an empty body",
      () => new Response("", { status: 200 }),
      "https://slopper.day answered GET /me without JSON. Is it a Slopper site?",
    ],
  ];

  it.each(CASES)("%s exits 1 with one clear line", async (_, reply, message) => {
    const cli = await harness({ "GET /api/v1/me": reply }, TOKEN);
    expect(await cli.run("whoami")).toEqual({ code: 1, stdout: "", stderr: `slopper: ${message}\n` });
  });

  it("prints validation problems field by field", async () => {
    const cli = await harness(
      {
        "POST /api/v1/slops": {
          status: 422,
          body: { error: "The slop needs fixing.", details: { tagline: "Say what it does.", links: "Add a link." } },
        },
      },
      TOKEN,
    );
    expect(await cli.run("launch", "--name", "TiltMaze")).toEqual({
      code: 1,
      stdout: "",
      stderr: "slopper: The slop needs fixing.\n  tagline: Say what it does.\n  links: Add a link.\n",
    });
  });

  it("reports the network failing instead of crashing", async () => {
    const refused = () => {
      throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND slopper.day") });
    };
    const cli = await harness({ "GET /api/v1/me": refused }, TOKEN);
    expect(await cli.run("whoami")).toEqual({
      code: 1,
      stdout: "",
      stderr: "slopper: Couldn't reach https://slopper.day: fetch failed (getaddrinfo ENOTFOUND slopper.day)\n",
    });
  });

  it("reports a connection that drops halfway through the reply", async () => {
    const dropped = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"username":'));
            controller.error(new Error("socket hang up"));
          },
        }),
      );
    const cli = await harness({ "GET /api/v1/me": dropped }, TOKEN);
    expect(await cli.run("whoami")).toEqual({
      code: 1,
      stdout: "",
      stderr: "slopper: Couldn't reach https://slopper.day: socket hang up\n",
    });
  });

  it("reports a real refused connection", async () => {
    const port = await closedPort();
    const cli = await harness({}, TOKEN, globalThis.fetch);
    const result = await cli.run("whoami", "--url", `http://127.0.0.1:${port}`);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      new RegExp(`^slopper: Couldn't reach http://127\\.0\\.0\\.1:${port}: fetch failed .*ECONNREFUSED`),
    );
  });
});

describe("which token and site", () => {
  const ME = { "GET /api/v1/me": { body: { username: "maker" } } };
  const used = (cli: Awaited<ReturnType<typeof harness>>) =>
    cli.calls.map((call) => [new URL(call.url).origin, call.authorization]);

  it("takes --token over SLOPPER_TOKEN over the saved one", async () => {
    const saved = await harness(ME);
    await saved.save(JSON.stringify({ token: "slp_saved" }));
    await saved.run("whoami");
    const env = await harness(ME, { SLOPPER_TOKEN: "slp_env" });
    await env.save(JSON.stringify({ token: "slp_saved" }));
    await env.run("whoami");
    await env.run("whoami", "--token", "slp_flag");
    expect([...used(saved), ...used(env)]).toEqual([
      ["https://slopper.day", "Bearer slp_saved"],
      ["https://slopper.day", "Bearer slp_env"],
      ["https://slopper.day", "Bearer slp_flag"],
    ]);
  });

  it("takes --url over SLOPPER_URL over the saved one over slopper.day", async () => {
    const plain = await harness(ME, TOKEN);
    await plain.run("whoami");
    await plain.save(JSON.stringify({ url: "http://saved.test:5173" }));
    await plain.run("whoami");
    const env = await harness(ME, { ...TOKEN, SLOPPER_URL: "http://env.test" });
    await env.save(JSON.stringify({ url: "http://saved.test:5173" }));
    await env.run("whoami");
    await env.run("whoami", "--url", "https://flag.test");
    expect([...used(plain), ...used(env)].map(([origin]) => origin)).toEqual([
      "https://slopper.day",
      "http://saved.test:5173",
      "http://env.test",
      "https://flag.test",
    ]);
  });

  it("treats an empty SLOPPER_TOKEN or SLOPPER_URL as unset", async () => {
    const cli = await harness(ME, { SLOPPER_TOKEN: "", SLOPPER_URL: "" });
    await cli.save(JSON.stringify({ token: "slp_saved", url: "http://saved.test" }));
    expect((await cli.run("whoami")).code).toBe(0);
    expect(used(cli)).toEqual([["http://saved.test", "Bearer slp_saved"]]);
  });

  it("drops paths and trailing slashes from the site", async () => {
    const cli = await harness(ME, TOKEN);
    await cli.run("whoami", "--url", "http://localhost:5173/");
    await cli.run("whoami", "--url", "https://slopper.day/settings/api/?tab=cli#token");
    expect(cli.calls.map((call) => call.url)).toEqual([
      "http://localhost:5173/api/v1/me",
      "https://slopper.day/api/v1/me",
    ]);
  });

  it("refuses an invalid site from the environment or the config", async () => {
    const env = await harness(ME, { ...TOKEN, SLOPPER_URL: "slopper" });
    expect(await env.run("whoami")).toMatchObject({ code: 2, stderr: expect.stringContaining("slopper isn't a URL.") });
    const saved = await harness(ME, TOKEN);
    await saved.save(JSON.stringify({ url: "mailto:maker@slopper.day" }));
    expect(await saved.run("whoami")).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("isn't an http(s) URL"),
    });
    expect([...env.calls, ...saved.calls]).toEqual([]);
  });

  it("asks for a token on the site it would use, before calling it", async () => {
    const cli = await harness();
    expect(await cli.run("whoami", "--url", "http://localhost:5173")).toEqual({
      code: 1,
      stdout: "",
      stderr:
        "slopper: No API token. Run `slopper login` to sign in from your browser, or set SLOPPER_TOKEN to one from http://localhost:5173/settings/api.\n",
    });
    expect(cli.calls).toEqual([]);
  });

  it("keeps the config in SLOPPER_CONFIG_DIR, or XDG_CONFIG_HOME, or ~/.config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "slopper-config-"));
    const custom = await harness(ME, { SLOPPER_CONFIG_DIR: dir });
    expect(JSON.parse((await custom.run("login", "--token", "slp_x")).stdout).config).toBe(join(dir, "config.json"));
    const plain = await harness(ME, { XDG_CONFIG_HOME: "" });
    expect(JSON.parse((await plain.run("login", "--token", "slp_x")).stdout).config).toBe(
      join(plain.home, ".config", "slopper", "config.json"),
    );
  });

  it("explains a config that isn't JSON, or isn't an object", async () => {
    const cli = await harness(ME, TOKEN);
    await cli.save("token=slp_test");
    expect(await cli.run("whoami")).toEqual({
      code: 1,
      stdout: "",
      stderr: `slopper: ${cli.configFile} isn't valid JSON. Fix it or run \`slopper logout\` to start over.\n`,
    });
    await cli.save("[]");
    expect(await cli.run("whoami")).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("should hold a JSON object"),
    });
    expect(cli.calls).toEqual([]);
  });

  it("reports a config it can't read instead of crashing", async () => {
    const cli = await harness(ME, TOKEN);
    await mkdir(cli.configFile, { recursive: true });
    expect(await cli.run("whoami")).toEqual({
      code: 1,
      stdout: "",
      stderr: `slopper: Couldn't read ${cli.configFile}: EISDIR: illegal operation on a directory, read\n`,
    });
  });
});

describe("login and logout", () => {
  const ME = { "GET /api/v1/me": { body: { username: "maker" } } };

  it("checks a piped token, saves it with its site for its owner only, then uses it", async () => {
    const cli = await harness(ME);
    cli.pipe("  slp_piped\n");
    expect(JSON.parse((await cli.run("login")).stdout)).toEqual({
      loggedIn: "maker",
      url: "https://slopper.day",
      config: cli.configFile,
    });
    expect(JSON.parse(await readFile(cli.configFile, "utf8"))).toEqual({
      token: "slp_piped",
      url: "https://slopper.day",
    });
    expect((await stat(cli.configFile)).mode & 0o777).toBe(0o600);
    expect((await stat(join(cli.home, ".config", "slopper"))).mode & 0o777).toBe(0o700);

    await cli.run("whoami");
    expect(cli.calls.map((call) => [call.url, call.authorization])).toEqual([
      ["https://slopper.day/api/v1/me", "Bearer slp_piped"],
      ["https://slopper.day/api/v1/me", "Bearer slp_piped"],
    ]);
  });

  it("takes --token over anything piped", async () => {
    const cli = await harness(ME);
    cli.pipe("slp_piped");
    await cli.run("login", "--token", "slp_flag");
    expect(JSON.parse(await readFile(cli.configFile, "utf8"))).toMatchObject({ token: "slp_flag" });
  });

  it("saves the site it checked the token on, from --url or SLOPPER_URL", async () => {
    const cli = await harness(ME, { SLOPPER_TOKEN: "slp_env" });
    await cli.run("login", "--token", "slp_local", "--url", "http://localhost:5173/anything");
    expect(JSON.parse(await readFile(cli.configFile, "utf8"))).toEqual({
      token: "slp_local",
      url: "http://localhost:5173",
    });
    // The saved site sticks; the environment's token still wins for one-off calls.
    await cli.run("today");
    expect(cli.calls.slice(1).map((call) => [call.url, call.authorization])).toEqual([
      ["http://localhost:5173/api/v1/today", "Bearer slp_env"],
    ]);

    const env = await harness(ME, { SLOPPER_URL: "http://staging.test" });
    await env.run("login", "--token", "slp_staging");
    expect(JSON.parse(await readFile(env.configFile, "utf8"))).toEqual({
      token: "slp_staging",
      url: "http://staging.test",
    });
  });

  it("narrows an older, wider config to its owner", async () => {
    const cli = await harness(ME);
    await cli.save(JSON.stringify({ token: "slp_old" }), 0o644);
    await chmod(cli.configFile, 0o644);
    await cli.run("login", "--token", "slp_new");
    expect((await stat(cli.configFile)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(cli.configFile, "utf8"))).toMatchObject({ token: "slp_new" });
  });

  it("refuses a bad token without writing anything", async () => {
    const cli = await harness({ "GET /api/v1/me": { status: 401, body: { error: "Missing or invalid API token." } } });
    expect(await cli.run("login", "--token", "slp_wrong")).toEqual({
      code: 1,
      stdout: "",
      stderr: "slopper: Missing or invalid API token.\n",
    });
    await expect(stat(cli.configFile)).rejects.toMatchObject({ code: "ENOENT" });

    // An earlier login stays as it was.
    const before = JSON.stringify({ token: "slp_good", url: "https://slopper.day" });
    await cli.save(before);
    expect((await cli.run("login", "--token", "slp_wrong")).code).toBe(1);
    expect(await readFile(cli.configFile, "utf8")).toBe(before);
  });

  it("refuses a site that doesn't answer like Slopper", async () => {
    const page = () => new Response("<!doctype html><title>Home</title>", { status: 200 });
    const cli = await harness({ "GET /api/v1/me": page });
    const result = await cli.run("login", "--token", "slp_x", "--url", "https://example.com");
    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: "slopper: https://example.com answered GET /me without JSON. Is it a Slopper site?\n",
    });
    const nobody = await harness({ "GET /api/v1/me": { body: { ok: true } } });
    expect(await nobody.run("login", "--token", "slp_x")).toMatchObject({
      code: 1,
      stderr: "slopper: https://slopper.day didn't say whose token this is.\n",
    });
    await expect(stat(cli.configFile)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(nobody.configFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  describe("from the browser, with no token", () => {
    const STARTED = {
      deviceCode: "device-secret",
      userCode: "BCDF-GHJK",
      url: "https://slopper.day/cli?code=BCDF-GHJK",
      interval: 2,
      expiresAt: 1_800_000_000_000,
    };
    const PENDING: Reply = { body: { status: "pending" } };
    const APPROVED: Reply = { body: { status: "approved", token: "slp_browser", username: "maker" } };
    const signIn = (...polls: Reply[]) => ({
      ...ME,
      "POST /api/cli/login": { body: STARTED },
      "POST /api/cli/token": polls,
    });
    const WAITING = "Check the page shows BCDF-GHJK, then approve it. Waiting…\n";

    it("opens the sign-in page, waits for approval, then checks and saves the token it gets", async () => {
      const cli = await harness(signIn(PENDING, PENDING, APPROVED));
      expect(await cli.run("login")).toEqual({
        code: 0,
        stdout: `${JSON.stringify({ loggedIn: "maker", url: "https://slopper.day", config: cli.configFile }, null, 2)}\n`,
        stderr: `Opened ${STARTED.url}\n${WAITING}`,
      });
      expect(cli.opened).toEqual([STARTED.url]);
      expect(cli.slept).toEqual([2000, 2000, 2000]);
      expect(cli.calls.map(({ method, url, authorization, body }) => [method, url, authorization, body])).toEqual([
        ["POST", "https://slopper.day/api/cli/login", null, { name: "slopper CLI on studio" }],
        ["POST", "https://slopper.day/api/cli/token", null, { deviceCode: "device-secret" }],
        ["POST", "https://slopper.day/api/cli/token", null, { deviceCode: "device-secret" }],
        ["POST", "https://slopper.day/api/cli/token", null, { deviceCode: "device-secret" }],
        ["GET", "https://slopper.day/api/v1/me", "Bearer slp_browser", null],
      ]);
      expect(JSON.parse(await readFile(cli.configFile, "utf8"))).toEqual({
        token: "slp_browser",
        url: "https://slopper.day",
      });
      expect((await stat(cli.configFile)).mode & 0o777).toBe(0o600);
    });

    it("signs in on the site it was pointed at", async () => {
      const cli = await harness(signIn(APPROVED));
      await cli.run("login", "--url", "http://localhost:5173/");
      expect(cli.calls[0].url).toBe("http://localhost:5173/api/cli/login");
      expect(JSON.parse(await readFile(cli.configFile, "utf8"))).toEqual({
        token: "slp_browser",
        url: "http://localhost:5173",
      });
    });

    it("prints the link to open with --no-browser, or when no browser opens", async () => {
      const flag = await harness(signIn(APPROVED));
      expect(await flag.run("login", "--no-browser")).toMatchObject({
        code: 0,
        stderr: `Open ${STARTED.url}\n${WAITING}`,
      });
      expect(flag.opened).toEqual([]);

      const headless = await harness(signIn(APPROVED));
      headless.noBrowser();
      expect(await headless.run("login")).toMatchObject({ code: 0, stderr: `Open ${STARTED.url}\n${WAITING}` });
      expect(headless.opened).toEqual([STARTED.url]);
    });

    it("takes a token passed or piped instead, and a blank pipe still signs in from the browser", async () => {
      const flag = await harness(signIn(APPROVED));
      await flag.run("login", "--token", "slp_flag");
      expect(flag.opened).toEqual([]);
      expect(flag.calls.map((call) => call.url)).toEqual(["https://slopper.day/api/v1/me"]);

      const blank = await harness(signIn(APPROVED));
      blank.pipe(" \n");
      expect((await blank.run("login")).code).toBe(0);
      expect(blank.opened).toEqual([STARTED.url]);
    });

    it("stops when the sign-in is denied or expires, and saves nothing", async () => {
      for (const [status, message] of [
        ["denied", "The sign-in was denied in the browser."],
        ["expired", "The sign-in expired. Run `slopper login` again."],
      ]) {
        const cli = await harness(signIn(PENDING, { body: { status } }));
        expect(await cli.run("login")).toEqual({
          code: 1,
          stdout: "",
          stderr: `Opened ${STARTED.url}\n${WAITING}slopper: ${message}\n`,
        });
        expect(cli.calls.some((call) => call.url.endsWith("/api/v1/me"))).toBe(false);
        await expect(stat(cli.configFile)).rejects.toMatchObject({ code: "ENOENT" });
      }
    });

    it("gives up when nobody approves it within eleven minutes", async () => {
      const cli = await harness(signIn(PENDING));
      expect(await cli.run("login")).toMatchObject({
        code: 1,
        stderr: expect.stringContaining("slopper: Nobody approved the sign-in in time. Run `slopper login` again.\n"),
      });
      expect(cli.slept.reduce((total, ms) => total + ms, 0)).toBe(11 * 60_000);
      await expect(stat(cli.configFile)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("reports a site that can't start a sign-in, or answers a poll oddly", async () => {
      const notStarted = await harness({ "POST /api/cli/login": { body: { ok: true } } });
      expect(await notStarted.run("login")).toEqual({
        code: 1,
        stdout: "",
        stderr: "slopper: https://slopper.day didn't start a browser sign-in. Is it a Slopper site?\n",
      });
      expect(notStarted.opened).toEqual([]);

      const oldSite = await harness({});
      expect(await oldSite.run("login")).toMatchObject({ code: 1, stderr: "slopper: No route.\n" });

      const odd = await harness(signIn({ body: { status: "approved" } }));
      expect(await odd.run("login")).toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "slopper: https://slopper.day answered the sign-in with something unexpected.\n",
        ),
      });

      const full = await harness(signIn({ status: 409, body: { error: "Up to 10 tokens. Revoke one first." } }));
      expect(await full.run("login")).toMatchObject({
        code: 1,
        stderr: expect.stringContaining("slopper: Up to 10 tokens. Revoke one first.\n"),
      });
      for (const cli of [notStarted, oldSite, odd, full]) {
        await expect(stat(cli.configFile)).rejects.toMatchObject({ code: "ENOENT" });
      }
    });
  });

  it("reports a config directory it can't create instead of crashing", async () => {
    const locked = await mkdtemp(join(tmpdir(), "slopper-locked-"));
    await chmod(locked, 0o500);
    const cli = await harness(ME, { SLOPPER_CONFIG_DIR: join(locked, "slopper") });
    expect(await cli.run("login", "--token", "slp_x")).toEqual({
      code: 1,
      stdout: "",
      stderr: `slopper: EACCES: permission denied, mkdir '${join(locked, "slopper")}'\n`,
    });
    await chmod(locked, 0o700);
  });

  it("logs out by removing the config, even a broken one", async () => {
    const cli = await harness(ME);
    await cli.run("login", "--token", "slp_x");
    expect(JSON.parse((await cli.run("logout")).stdout)).toEqual({ loggedOut: true, config: cli.configFile });
    await expect(stat(cli.configFile)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await cli.run("whoami")).toMatchObject({ code: 1, stderr: expect.stringContaining("No API token") });

    // The broken-config error says to log out, so that has to work.
    await cli.save("{ not json");
    expect((await cli.run("whoami")).stderr).toContain("run `slopper logout`");
    expect((await cli.run("logout")).code).toBe(0);
    await expect(stat(cli.configFile)).rejects.toMatchObject({ code: "ENOENT" });
    // Nothing to remove is fine too.
    expect((await cli.run("logout")).code).toBe(0);
  });
});

describe("promo videos", () => {
  const VIDEO = { status: 201, body: { id: "media_video" } };
  const SET = { body: { slop: { id: "slop_1", video: "pending" } } };

  it.each([
    ["promo.mp4", "video/mp4"],
    ["promo.M4V", "video/mp4"],
    ["promo.webm", "video/webm"],
  ])("uploads %s as %s, then puts it on the slop", async (file, contentType) => {
    const cli = await harness({ "POST /api/v1/videos": VIDEO, "PUT /api/v1/slops/tiltmaze/video": SET }, TOKEN);
    const path = join(cli.home, file);
    await writeFile(path, new Uint8Array([0, 0, 0, 24]));
    expect(await cli.run("video", "tiltmaze", path)).toEqual({
      code: 0,
      stdout: `${JSON.stringify(SET.body, null, 2)}\n`,
      stderr: "",
    });
    expect(cli.calls).toMatchObject([
      { method: "POST", url: "https://slopper.day/api/v1/videos", contentType, body: [0, 0, 0, 24] },
      { method: "PUT", url: "https://slopper.day/api/v1/slops/tiltmaze/video", body: { video: "media_video" } },
    ]);
  });

  it("puts an uploaded video's id on as it is, and takes one off with --remove", async () => {
    const cli = await harness({ "PUT /api/v1/slops/tiltmaze/video": SET }, TOKEN);
    await cli.run("video", "tiltmaze", "media_video");
    await cli.run("video", "tiltmaze", "--remove");
    expect(cli.calls.map(({ method, url, body }) => [method, url, body])).toEqual([
      ["PUT", "https://slopper.day/api/v1/slops/tiltmaze/video", { video: "media_video" }],
      ["PUT", "https://slopper.day/api/v1/slops/tiltmaze/video", { video: null }],
    ]);
  });

  it("refuses what isn't a video, a video and --remove together, or nothing at all, before sending", async () => {
    const cli = await harness({}, TOKEN);
    const gif = join(cli.home, "promo.gif");
    await writeFile(gif, new Uint8Array([1]));
    expect(await cli.run("video", "tiltmaze", gif)).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("isn't an MP4 or WebM video."),
    });
    expect(await cli.run("video", "tiltmaze", "media_video", "--remove")).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("Pass a video or --remove, not both."),
    });
    expect(await cli.run("video", "tiltmaze")).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("Missing <file|id>."),
    });
    expect(await cli.run("video", "tiltmaze", join(cli.home, "missing.mp4"))).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("Couldn't read"),
    });
    const big = join(cli.home, "big.mp4");
    await writeFile(big, new Uint8Array(4 * 1024 * 1024 + 1));
    expect(await cli.run("video", "tiltmaze", big)).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("bigger than 4 MB"),
    });
    expect(cli.calls).toEqual([]);
  });
});

describe("screenshots", () => {
  const MEDIA = { status: 201, body: { id: "media_1", url: "https://cdn.test/x.png", contentCheck: "ok" } };

  it.each([
    ["cover.png", "image/png"],
    ["cover.PNG", "image/png"],
    ["cover.jpg", "image/jpeg"],
    ["cover.jpeg", "image/jpeg"],
    ["cover.webp", "image/webp"],
    ["cover.gif", "image/gif"],
  ])("uploads %s as %s and prints the media id and verdict", async (file, contentType) => {
    const cli = await harness({ "POST /api/v1/media": MEDIA }, TOKEN);
    const path = join(cli.home, file);
    await writeFile(path, new Uint8Array([1, 2, 3]));
    expect(await cli.run("upload", path)).toEqual({
      code: 0,
      stdout: `${JSON.stringify(MEDIA.body, null, 2)}\n`,
      stderr: "",
    });
    expect(cli.calls).toMatchObject([
      { method: "POST", url: "https://slopper.day/api/v1/media", contentType, body: [1, 2, 3] },
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

  it("replaces an edited slop's screenshots, uploading files first", async () => {
    const cli = await harness(
      { "POST /api/v1/media": MEDIA, "PATCH /api/v1/slops/tiltmaze": { body: { slop: { id: "slop_1" } } } },
      TOKEN,
    );
    await writeFile(join(cli.home, "editor.webp"), new Uint8Array([9]));
    await cli.run("edit", "tiltmaze", "--screenshot", join(cli.home, "editor.webp"), "--screenshot", "media_old");
    expect(cli.calls.map((call) => [call.method, new URL(call.url).pathname, call.body])).toEqual([
      ["POST", "/api/v1/media", [9]],
      ["PATCH", "/api/v1/slops/tiltmaze", { screenshots: ["media_1", "media_old"] }],
    ]);
  });

  it("refuses files it can't read or send, before calling the site", async () => {
    const cli = await harness({}, TOKEN);
    expect(await cli.run("launch", "--name", "X", "--screenshot", "./nowhere/shot.png")).toEqual({
      code: 2,
      stdout: "",
      stderr: usage("launch", "Couldn't read ./nowhere/shot.png (ENOENT)."),
    });
    await mkdir(join(cli.home, "folder.png"));
    expect(await cli.run("upload", join(cli.home, "folder.png"))).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("(EISDIR)."),
    });
    for (const file of ["deck.pdf", "logo.svg", "./shots/cover"]) {
      expect(await cli.run("upload", file)).toEqual({
        code: 2,
        stdout: "",
        stderr: usage("upload", `${file} isn't a PNG, JPEG, WebP or GIF.`),
      });
    }
    expect(cli.calls).toEqual([]);
  });

  it("refuses screenshots over the site's limit without sending them", async () => {
    expect(MEDIA_BYTES).toBe(LIMITS.mediaBytes);
    expect(VIDEO_BYTES).toBe(LIMITS.videoBytes);
    const cli = await harness({ "POST /api/v1/media": MEDIA }, TOKEN);
    const big = join(cli.home, "big.png");
    await writeFile(big, new Uint8Array(MEDIA_BYTES + 1));
    expect(await cli.run("upload", big)).toEqual({
      code: 2,
      stdout: "",
      stderr: usage("upload", `${big} is bigger than 4 MB, the most a screenshot can be.`),
    });
    expect(cli.calls).toEqual([]);
    const edge = join(cli.home, "edge.png");
    await writeFile(edge, new Uint8Array(MEDIA_BYTES));
    expect((await cli.run("upload", edge)).code).toBe(0);
    expect(cli.calls).toHaveLength(1);
  });

  it("stops a launch when a screenshot is refused", async () => {
    const cli = await harness(
      {
        "POST /api/v1/media": { status: 400, body: { error: "This image can't go on Slopper." } },
        "POST /api/v1/slops": { status: 201, body: {} },
      },
      TOKEN,
    );
    await writeFile(join(cli.home, "nope.png"), new Uint8Array([1]));
    expect(await cli.run("launch", "--name", "X", "--screenshot", join(cli.home, "nope.png"))).toEqual({
      code: 1,
      stdout: "",
      stderr: "slopper: This image can't go on Slopper.\n",
    });
    expect(cli.calls.map((call) => new URL(call.url).pathname)).toEqual(["/api/v1/media"]);
  });

  it("says when an upload comes back without a media id", async () => {
    const cli = await harness(
      { "POST /api/v1/media": { status: 201, body: { url: "https://cdn.test/x.png" } } },
      TOKEN,
    );
    await writeFile(join(cli.home, "cover.png"), new Uint8Array([1]));
    expect(await cli.run("upload", join(cli.home, "cover.png"))).toEqual({
      code: 1,
      stdout: "",
      stderr: `slopper: Uploading ${join(cli.home, "cover.png")} returned no media id.\n`,
    });
  });
});

describe("skill", () => {
  it("prints SKILL.md as it is in @slopperday/skill", async () => {
    const cli = await harness();
    const printed = await cli.run("skill");
    expect(printed).toEqual({
      code: 0,
      stdout: await readFile(new URL("../../skill/SKILL.md", import.meta.url), "utf8"),
      stderr: "",
    });
    expect(printed.stdout).toMatch(/^---\nname: slopper\n/);
  });

  it("installs it where agents look, or in --dir, and again over an older copy", async () => {
    const cli = await harness();
    const printed = (await cli.run("skill")).stdout;
    const installed = await cli.run("skill", "install");
    const path = join(cli.home, ".agents", "skills", "slopper", "SKILL.md");
    expect(JSON.parse(installed.stdout)).toEqual({ installed: path });
    expect(await readFile(path, "utf8")).toBe(printed);

    const claude = join(cli.home, ".claude", "skills");
    await mkdir(join(claude, "slopper"), { recursive: true });
    await writeFile(join(claude, "slopper", "SKILL.md"), "an older skill");
    expect(JSON.parse((await cli.run("skill", "install", "--dir", claude)).stdout)).toEqual({
      installed: join(claude, "slopper", "SKILL.md"),
    });
    expect(await readFile(join(claude, "slopper", "SKILL.md"), "utf8")).toBe(printed);
  });

  it("needs no token, site or readable config", async () => {
    const cli = await harness({}, { SLOPPER_URL: "not a url" });
    await cli.save("{ broken");
    expect((await cli.run("skill")).code).toBe(0);
    expect((await cli.run("skill", "install")).code).toBe(0);
    expect(cli.calls).toEqual([]);
  });
});
