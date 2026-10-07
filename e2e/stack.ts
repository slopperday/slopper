/**
 * A throwaway Slopper for the end-to-end tests, run by Playwright's
 * `webServer` after `vp build`:
 *
 * - a fresh Convex backend (the binary the Convex CLI already downloaded),
 *   with its own data in `.e2e/` that's deleted on every run;
 * - a fake DeepSeek that answers the content check by marker
 *   (`[e2e:mature]`, `[e2e:blocked]`) and logs what it was sent;
 * - the production build, served by Deno exactly as on Deno Deploy.
 *
 * Nothing touches your dev backend on :3210. The details tests need
 * (URLs, the admin key, the signing key) land in `.e2e/stack.json`.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { generateServerKeys } from "../scripts/server-keys.ts";
import { E2E_ADMIN, type FakeCheckRequest, PORTS, STACK_FILE, type Stack } from "./ports.ts";

const ROOT = resolve(import.meta.dirname, "..");
const STATE = join(ROOT, ".e2e");
const CONVEX_URL = `http://127.0.0.1:${PORTS.convex}`;
const APP_URL = `http://127.0.0.1:${PORTS.app}`;
const CHECK_URL = `http://127.0.0.1:${PORTS.check}`;

const children: ChildProcess[] = [];

function stop(code: number): never {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

function backendBinary(): string {
  const dir = join(homedir(), ".cache", "convex", "binaries");
  const versions = existsSync(dir) ? readdirSync(dir).sort() : [];
  const latest = versions.at(-1);
  if (!latest)
    throw new Error("No Convex backend binary yet. Run `vp run convex` once so the Convex CLI downloads it.");
  return join(dir, latest, "convex-local-backend");
}

async function waitFor(url: string, what: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`${what} didn't come up at ${url}.`);
}

function run(command: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync(command, args, { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env } });
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

/**
 * Stands in for DeepSeek's chat completions. It rejects requests that drift
 * from what the real check must send (policy first, JSON mode, no thinking),
 * so the tests catch a broken request, not just a broken reply.
 */
function startFakeCheck(): void {
  const log: FakeCheckRequest[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/__requests") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(log));
      return;
    }
    const body = JSON.parse(await readBody(request)) as {
      messages: { role: string; content: string | { type: string; text?: string }[] }[];
      response_format?: { type: string };
      thinking?: { type: string };
    };
    const [system, user] = body.messages;
    const parts = Array.isArray(user?.content) ? user.content : [];
    const text = parts.map((part) => part.text ?? "").join("\n");
    const images = parts.filter((part) => part.type === "image_url").length;
    const wellFormed =
      request.headers.authorization === "Bearer e2e-key" &&
      system?.role === "system" &&
      typeof system.content === "string" &&
      system.content.includes("json") &&
      body.response_format?.type === "json_object" &&
      body.thinking?.type === "disabled";
    if (!wellFormed) {
      response.writeHead(400, { "content-type": "application/json" }).end('{"error":"malformed check request"}');
      return;
    }
    const verdict = text.includes("[e2e:blocked]") ? "blocked" : text.includes("[e2e:mature]") ? "mature" : "ok";
    log.push({ text, images, verdict });
    const reply = { verdict, reason: `Fake check: ${verdict}.` };
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(reply) } }] }));
  });
  server.listen(PORTS.check, "127.0.0.1");
}

async function main(): Promise<void> {
  rmSync(STATE, { recursive: true, force: true });
  mkdirSync(join(STATE, "convex"), { recursive: true });

  // 1. A fresh Convex backend with its own admin key.
  const binary = backendBinary();
  const instanceName = "slopper-e2e";
  const instanceSecret = randomBytes(32).toString("hex");
  const adminKey = execFileSync(binary, [
    "keygen",
    "admin-key",
    "--instance-name",
    instanceName,
    "--instance-secret",
    instanceSecret,
  ])
    .toString()
    .trim();
  const backend = spawn(
    binary,
    [
      "--port",
      String(PORTS.convex),
      "--site-proxy-port",
      String(PORTS.convexSite),
      "--instance-name",
      instanceName,
      "--instance-secret",
      instanceSecret,
      "--local-storage",
      join(STATE, "convex", "storage"),
      "--disable-beacon",
      join(STATE, "convex", "db.sqlite3"),
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  children.push(backend);
  backend.on("exit", (code) => code !== null && code !== 0 && stop(1));
  await waitFor(`${CONVEX_URL}/version`, "The Convex backend");

  // 2. Trust the app's signing key, then push the functions. Auth config
  //    reads the env at push time, so the keys go first.
  const envFile = join(STATE, "convex.env");
  writeFileSync(envFile, `CONVEX_SELF_HOSTED_URL=${CONVEX_URL}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}\n`);
  const keys = await generateServerKeys();
  const convex = join(ROOT, "node_modules", ".bin", "convex");
  run(convex, ["env", "set", "--env-file", envFile, "SLOPPER_JWT_ISSUER", APP_URL]);
  run(convex, ["env", "set", "--env-file", envFile, "SLOPPER_JWKS", keys.jwks]);
  run(convex, ["deploy", "--env-file", envFile, "--codegen", "disable", "--typecheck", "disable"]);

  // 3. The content check.
  startFakeCheck();

  // 4. The production build, as Deno Deploy runs it.
  const app = spawn("deno", ["run", "-A", "deploy/main.ts"], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PORT: String(PORTS.app),
      APP_URL,
      CONVEX_URL,
      SLOPPER_JWT_ISSUER: APP_URL,
      SLOPPER_JWT_PRIVATE_KEY: keys.privateKey,
      SLOPPER_SECRET_KEY: randomBytes(32).toString("base64"),
      ADMIN_USERNAMES: E2E_ADMIN,
      DEEPSEEK_API_KEY: "e2e-key",
      DEEPSEEK_BASE_URL: CHECK_URL,
      // Never called: the tests only check where the button sends people.
      GITHUB_CLIENT_ID: "e2e-github-client",
      GITHUB_CLIENT_SECRET: "e2e-github-secret",
    },
  });
  children.push(app);
  app.on("exit", (code) => code !== null && code !== 0 && stop(1));

  const stack: Stack = {
    appUrl: APP_URL,
    convexUrl: CONVEX_URL,
    checkUrl: CHECK_URL,
    adminKey,
    issuer: APP_URL,
    privateKey: keys.privateKey,
  };
  writeFileSync(join(ROOT, STACK_FILE), JSON.stringify(stack, null, 2));
  await waitFor(`${APP_URL}/rules`, "The app server");
  console.log(`Slopper e2e stack is up at ${APP_URL}`);
}

main().catch((error: unknown) => {
  console.error(error);
  stop(1);
});
