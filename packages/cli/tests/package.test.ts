import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import manifest from "../package.json" with { type: "json" };

/**
 * The CLI as npm ships it. `npm pack` builds and packs it the way the release
 * publishes it (`npm publish`, prepack and all); the tarball is installed on
 * its own into a fresh project and run as a real process under Node, Bun and
 * Deno. Then every package runner the docs name fetches it from a stand-in
 * registry, the way agents run it without installing anything.
 */

const CLI_DIR = fileURLToPath(new URL("..", import.meta.url));
const SKILL_DIR = fileURLToPath(new URL("../../skill", import.meta.url));
const TOKEN = "slp_smoke";

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a command to the end, with only the environment it's given and stdin closed after `input`. */
function run(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; input?: string },
): Promise<Result> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, timeout: 90_000 });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => void (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => void (stderr += chunk));
    child.stdin.end(options.input);
    child.on("error", fail);
    child.on("close", (code) => done({ code, stdout, stderr }));
  });
}

async function succeed(command: string, args: string[], options: { cwd: string; env: Record<string, string> }) {
  const result = await run(command, args, options);
  if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function installed(command: string): boolean {
  return spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((done) => server.close(() => done()));
}

/**
 * A new home directory, so no runner reads this machine's config, caches or saved token. It has its own temp
 * directory too (`scratch`): bunx installs under TMPDIR, and a shared one hands an earlier run's build to the next.
 */
async function home(root: string, name: string): Promise<string> {
  const path = join(root, "homes", name);
  await mkdir(scratch(path), { recursive: true });
  return path;
}

function scratch(homeDir: string): string {
  return join(homeDir, "tmp");
}

/** npm with no user config (no tokens, no registry overrides) and a cache of its own. */
function npmEnv(root: string, homeDir: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    TMPDIR: scratch(homeDir),
    HOME: homeDir,
    npm_config_userconfig: join(root, "empty.npmrc"),
    npm_config_cache: join(root, "npm-cache"),
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
    npm_config_audit: "false",
  };
}

/** slopper.day's stand-in: GET /api/v1/me for the one token it knows. */
function startSite() {
  const seen: { authorization?: string; userAgent?: string }[] = [];
  const server = createServer((request, response) => {
    seen.push({ authorization: request.headers.authorization, userAgent: request.headers["user-agent"] });
    const json = (status: number, body: object) =>
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.method !== "GET" || request.url !== "/api/v1/me") return json(404, { error: "No route." });
    if (request.headers.authorization !== `Bearer ${TOKEN}`)
      return json(401, { error: "Missing or invalid API token." });
    json(200, { username: "smoke", votesLeft: 5 });
  });
  return { server, seen };
}

let root: string;
let cliTarball: string;
let skillTarball: string;
/** The project the CLI tarball was installed into, alone. */
let project: string;
let site: ReturnType<typeof startSite>;
let siteUrl: string;
const skillText = await readFile(join(SKILL_DIR, "SKILL.md"), "utf8");

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "slopper-package-")));
  await writeFile(join(root, "empty.npmrc"), "");
  const env = npmEnv(root, await home(root, "npm"));
  const tarballs = join(root, "tarballs");
  await mkdir(tarballs);
  // The same command the release runs in each package, so prepack builds dist/ here.
  await succeed("npm", ["pack", "--pack-destination", tarballs], { cwd: CLI_DIR, env });
  await succeed("npm", ["pack", "--pack-destination", tarballs], { cwd: SKILL_DIR, env });
  cliTarball = join(tarballs, `slopperday-cli-${manifest.version}.tgz`);
  skillTarball = join(tarballs, `slopperday-skill-${manifest.version}.tgz`);

  project = join(root, "project");
  await mkdir(project);
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module" }));
  // Offline: the CLI must install with nothing from the registry.
  await succeed("npm", ["install", "--offline", "--no-package-lock", cliTarball], { cwd: project, env });

  site = startSite();
  siteUrl = await listen(site.server);
}, 120_000);

afterAll(async () => {
  if (site) await close(site.server);
  // Tarballs, installs and every runner's cache.
  if (root) await rm(root, { recursive: true, force: true });
});

/** Paths inside a tarball, without npm's `package/` prefix. */
function tarballFiles(tarball: string): string[] {
  const listing = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  if (listing.status !== 0) throw new Error(listing.stderr);
  return listing.stdout
    .split("\n")
    .filter(Boolean)
    .map((path) => path.replace(/^package\//, ""))
    .sort();
}

async function packedManifest(tarball: string): Promise<string> {
  const dir = await mkdtemp(join(root, "unpacked-"));
  const unpacked = spawnSync("tar", ["-xzf", tarball, "-C", dir]);
  if (unpacked.status !== 0) throw new Error(String(unpacked.stderr));
  return await readFile(join(dir, "package", "package.json"), "utf8");
}

describe("the packed tarballs", () => {
  it("ship the CLI as one self-contained file", async () => {
    expect(tarballFiles(cliTarball)).toEqual(["README.md", "dist/slopper.mjs", "package.json"]);
    const packed = await packedManifest(cliTarball);
    // npm publishes package.json as it is: a workspace link would break every install.
    expect(packed).not.toContain("workspace:");
    const json = JSON.parse(packed) as Record<string, unknown>;
    expect(json).toMatchObject({ name: "@slopperday/cli", version: manifest.version, type: "module" });
    expect(json.dependencies).toBeUndefined();
    expect(json.peerDependencies).toBeUndefined();
    expect(json.optionalDependencies).toBeUndefined();

    const bin = await readFile(join(project, "node_modules", "@slopperday", "cli", "dist", "slopper.mjs"), "utf8");
    expect(bin.startsWith("#!/usr/bin/env node\n")).toBe(true);
    // ESM that imports only Node's built-ins, with SKILL.md inside it.
    const imports = [...bin.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
    expect(imports.every((specifier) => specifier.startsWith("node:"))).toBe(true);
    expect(bin).not.toMatch(/\brequire\(|import\.meta\.resolve|@slopperday\/skill\/SKILL\.md/);
    expect(bin).toContain(JSON.stringify(skillText));
  });

  it("ship the skill as SKILL.md, importable by its export", async () => {
    expect(tarballFiles(skillTarball)).toEqual(["README.md", "SKILL.md", "package.json"]);
    expect(await packedManifest(skillTarball)).not.toContain("workspace:");

    const skillProject = join(root, "skill-project");
    await mkdir(skillProject);
    await writeFile(join(skillProject, "package.json"), JSON.stringify({ name: "skill-smoke", private: true }));
    const env = npmEnv(root, await home(root, "skill"));
    await succeed("npm", ["install", "--offline", "--no-package-lock", skillTarball], { cwd: skillProject, env });
    const resolved = await succeed(
      "node",
      ["--input-type=module", "-e", 'console.log(import.meta.resolve("@slopperday/skill/SKILL.md"))'],
      { cwd: skillProject, env },
    );
    expect(await readFile(new URL(resolved.trim()), "utf8")).toBe(skillText);
  });
});

/** How each runtime runs the installed CLI. Node goes through npm's bin link and the shebang. */
const RUNTIMES: { name: string; available: boolean; command: (args: string[]) => [string, string[]] }[] = [
  { name: "Node", available: true, command: (args) => [join(project, "node_modules", ".bin", "slopper"), args] },
  { name: "Bun", available: installed("bun"), command: (args) => ["bun", [installedBin(), ...args]] },
  { name: "Deno", available: installed("deno"), command: (args) => ["deno", ["run", "-A", installedBin(), ...args]] },
];

function installedBin(): string {
  return join(project, "node_modules", "@slopperday", "cli", "dist", "slopper.mjs");
}

for (const runtime of RUNTIMES) {
  describe.skipIf(!runtime.available)(`installed, under ${runtime.name}`, () => {
    let homeDir: string;
    let env: Record<string, string>;
    const slopper = (args: string[], input?: string) => {
      const [command, argv] = runtime.command(args);
      return run(command, argv, { cwd: project, env, input });
    };

    beforeAll(async () => {
      homeDir = await home(root, runtime.name);
      env = {
        PATH: process.env.PATH ?? "",
        TMPDIR: scratch(homeDir),
        HOME: homeDir,
        DENO_DIR: join(homeDir, "deno"),
        DENO_NO_UPDATE_CHECK: "1",
      };
    });

    it("prints its version and help, and exits 2 for an unknown command", async () => {
      expect(await slopper(["--version"])).toEqual({ code: 0, stdout: `${manifest.version}\n`, stderr: "" });
      const help = await slopper(["--help"]);
      expect(help).toMatchObject({ code: 0, stderr: "" });
      expect(help.stdout).toContain(`slopper ${manifest.version}: throw slop at the wall`);
      expect(help.stdout).toContain("\n  launch ");
      expect(await slopper(["nope"])).toEqual({
        code: 2,
        stdout: "",
        stderr: "slopper: Unknown command “nope”.\nRun `slopper help` for the commands.\n",
      });
    }, 60_000);

    it("prints and installs the skill it was built with, with no other package installed", async () => {
      expect(await slopper(["skill"])).toEqual({ code: 0, stdout: skillText, stderr: "" });
      const installedSkill = await slopper(["skill", "install"]);
      expect(installedSkill.code).toBe(0);
      const path = join(homeDir, ".agents", "skills", "slopper", "SKILL.md");
      expect(JSON.parse(installedSkill.stdout)).toEqual({ installed: path });
      expect(await readFile(path, "utf8")).toBe(skillText);
    }, 60_000);

    it("logs in with a piped token, saves it for its owner only, and calls the site with it", async () => {
      const before = site.seen.length;
      const login = await slopper(["login", "--url", siteUrl], `${TOKEN}\n`);
      const config = join(homeDir, ".config", "slopper", "config.json");
      expect(login).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(login.stdout)).toEqual({ loggedIn: "smoke", url: siteUrl, config });
      expect(JSON.parse(await readFile(config, "utf8"))).toEqual({ token: TOKEN, url: siteUrl });
      expect((await stat(config)).mode & 0o777).toBe(0o600);

      const me = await slopper(["whoami"]);
      expect(me).toMatchObject({ code: 0, stderr: "" });
      expect(JSON.parse(me.stdout)).toEqual({ username: "smoke", votesLeft: 5 });
      expect(site.seen.slice(before)).toEqual([
        { authorization: `Bearer ${TOKEN}`, userAgent: `slopper-cli/${manifest.version}` },
        { authorization: `Bearer ${TOKEN}`, userAgent: `slopper-cli/${manifest.version}` },
      ]);

      // Nothing piped and no --token: a usage mistake, not a wait for input that never comes.
      expect((await slopper(["login", "--url", siteUrl])).code).toBe(2);
      expect(await slopper(["whoami", "--token", "slp_wrong"])).toEqual({
        code: 1,
        stdout: "",
        stderr: "slopper: Missing or invalid API token.\n",
      });
    }, 60_000);

    it("exits 1 when the site can't be reached", async () => {
      const gone = createServer();
      const url = await listen(gone);
      await close(gone);
      const result = await slopper(["whoami", "--token", TOKEN, "--url", url]);
      expect(result).toMatchObject({ code: 1, stdout: "" });
      expect(result.stderr).toMatch(new RegExp(`^slopper: Couldn't reach ${url.replaceAll(".", "\\.")}: .+\\n$`));
    }, 60_000);
  });
}

/**
 * A stand-in npm registry with just @slopperday/cli, published long enough
 * ago that no runner's minimum release age holds it back.
 */
async function startRegistry(tarball: string) {
  const bytes = await readFile(tarball);
  const packed = JSON.parse(await packedManifest(tarball)) as Record<string, unknown>;
  const name = "@slopperday/cli";
  const file = `/${name}/-/cli-${manifest.version}.tgz`;
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://registry").pathname);
    if (path === file) {
      response.writeHead(200, { "content-type": "application/octet-stream" }).end(bytes);
      return;
    }
    if (path !== `/${name}`) {
      response.writeHead(404, { "content-type": "application/json" }).end('{"error":"Not found"}');
      return;
    }
    const version = {
      ...packed,
      _id: `${name}@${manifest.version}`,
      dist: {
        tarball: `${url}${file}`,
        shasum: createHash("sha1").update(bytes).digest("hex"),
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      },
    };
    const published = "2026-01-01T00:00:00.000Z";
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        name,
        "dist-tags": { latest: manifest.version },
        versions: { [manifest.version]: version },
        time: { created: published, modified: published, [manifest.version]: published },
      }),
    );
  });
  const url = await listen(server);
  return { server, url };
}

/** Each way the docs tell agents to run the CLI without installing it, and how to point it at the registry. */
const RUNNERS: {
  name: string;
  command: string;
  args: string[];
  env: (registry: string, dir: string) => Record<string, string>;
}[] = [
  {
    name: "npx -y",
    command: "npx",
    args: ["-y", "@slopperday/cli"],
    env: (registry) => ({ npm_config_registry: `${registry}/` }),
  },
  {
    name: "pnpm dlx",
    command: "pnpm",
    args: ["dlx", "@slopperday/cli"],
    // pnpm 11 and later read pnpm_config_*, not npm_config_*; its store and cache go under the new HOME.
    env: (registry) => ({ pnpm_config_registry: `${registry}/` }),
  },
  {
    name: "bunx",
    command: "bunx",
    args: ["@slopperday/cli"],
    env: (registry, dir) => ({ BUN_CONFIG_REGISTRY: `${registry}/`, BUN_INSTALL_CACHE_DIR: join(dir, "bun-cache") }),
  },
  {
    // Without -q, yarn prints its install log on stdout, ahead of the JSON.
    name: "yarn dlx -q",
    command: "yarn",
    args: ["dlx", "-q", "@slopperday/cli"],
    env: (registry, dir) => ({
      YARN_NPM_REGISTRY_SERVER: registry,
      YARN_UNSAFE_HTTP_WHITELIST: "127.0.0.1",
      YARN_GLOBAL_FOLDER: join(dir, "yarn-global"),
      YARN_CACHE_FOLDER: join(dir, "yarn-cache"),
      YARN_ENABLE_TELEMETRY: "0",
    }),
  },
  {
    name: "deno run -A npm:",
    command: "deno",
    args: ["run", "-A", "npm:@slopperday/cli"],
    env: (registry, dir) => ({
      NPM_CONFIG_REGISTRY: `${registry}/`,
      DENO_DIR: join(dir, "deno"),
      DENO_NO_UPDATE_CHECK: "1",
    }),
  },
];

describe("from a registry, with every package runner", () => {
  let registry: Awaited<ReturnType<typeof startRegistry>>;

  beforeAll(async () => {
    registry = await startRegistry(cliTarball);
  });

  afterAll(async () => {
    if (registry) await close(registry.server);
  });

  for (const runner of RUNNERS) {
    it.skipIf(!installed(runner.command))(
      `${runner.name} runs it with SLOPPER_TOKEN and writes no config`,
      async () => {
        const dir = await home(root, runner.name.replace(/\W+/g, "-"));
        const env = {
          ...npmEnv(root, dir),
          npm_config_cache: join(dir, "npm-cache"),
          ...runner.env(registry.url, dir),
        };
        const version = await run(runner.command, [...runner.args, "--version"], { cwd: dir, env });
        expect(version, version.stderr).toMatchObject({ code: 0, stdout: `${manifest.version}\n` });

        const agentEnv = { ...env, SLOPPER_TOKEN: TOKEN, SLOPPER_URL: siteUrl };
        const me = await run(runner.command, [...runner.args, "whoami"], { cwd: dir, env: agentEnv });
        expect(me.code).toBe(0);
        expect(JSON.parse(me.stdout)).toEqual({ username: "smoke", votesLeft: 5 });
        await expect(stat(join(dir, ".config", "slopper"))).rejects.toMatchObject({ code: "ENOENT" });
      },
      90_000,
    );
  }
});
