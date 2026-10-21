/**
 * A throwaway Slopper for the end-to-end tests, run by Playwright's
 * `webServer` after `vp build`:
 *
 * - a fresh Convex backend (the binary the Convex CLI already downloaded),
 *   with its own data in `.e2e/` that's deleted on every run;
 * - a fake OpenRouter that answers the content check by marker
 *   (`[e2e:mature]`, `[e2e:blocked]`, in a launch's text, an uploaded
 *   file's name or a video's bytes; `[e2e:error]` fails the call) and logs
 *   what it was sent, and makes embeddings for search by meaning
 *   (e2e/fake-embeddings.ts);
 * - a fake B2 bucket that checks every write's signature (e2e/fake-s3.ts),
 *   so screenshots take the production path;
 * - the production build: build/client and the Netlify Function, served by
 *   scripts/serve.ts the way Netlify serves them.
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
import { generateServerKeys, generateVapidKeys } from "../scripts/server-keys.ts";
import { EMBEDDING_MODEL } from "../convex/lib/embeddings.ts";
import { fakeEmbedding } from "./fake-embeddings.ts";
import { sha256Hex, startFakeS3 } from "./fake-s3.ts";
import {
  E2E_ADMIN_IDENTITY,
  E2E_WALLET,
  type FakeCheckRequest,
  type FakeEmail,
  PORTS,
  STACK_FILE,
  type Stack,
} from "./ports.ts";

const ROOT = resolve(import.meta.dirname, "..");
const STATE = join(ROOT, ".e2e");
const CONVEX_URL = `http://127.0.0.1:${PORTS.convex}`;
const CONVEX_SITE_URL = `http://127.0.0.1:${PORTS.convexSite}`;
const APP_URL = `http://127.0.0.1:${PORTS.app}`;
const CHECK_URL = `http://127.0.0.1:${PORTS.check}`;
const S3_URL = `http://127.0.0.1:${PORTS.s3}`;
const BUCKET = "slopper-e2e";
/** Like B2's friendly download URL, deliberately not the S3 path the app writes to. */
const MEDIA_URL = `${S3_URL}/file/${BUCKET}`;
const S3_CREDENTIALS = { keyId: "e2e-key-id", secret: randomBytes(24).toString("base64"), region: "us-west-004" };

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

interface RpcCall {
  id: number;
  method: string;
  params: unknown[];
}

const E2E_TOKEN_ACCOUNT = "E2eT0kenAcc0untE2eT0kenAcc0untE2eT0kenAcc0";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Stands in for Solana JSON-RPC: just enough for the wallet integration to find one payment. */
function fakeSolana({ id, method, params }: RpcCall): { jsonrpc: "2.0"; id: number; result: unknown } {
  const reply = (result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
  const [address, options] = params as [string, { mint?: string }];
  switch (method) {
    case "getTokenAccountsByOwner":
      return reply({
        context: { slot: 1 },
        value: address === E2E_WALLET && options.mint === USDC ? [{ pubkey: E2E_TOKEN_ACCOUNT }] : [],
      });
    case "getSignaturesForAddress":
      return reply(
        address === E2E_TOKEN_ACCOUNT
          ? [{ signature: "e2e-payment", err: null, blockTime: Math.floor(Date.now() / 1000) - 3600 }]
          : [],
      );
    case "getTransaction":
      return reply({
        blockTime: Math.floor(Date.now() / 1000) - 3600,
        meta: {
          err: null,
          preTokenBalances: [{ accountIndex: 1, mint: USDC, owner: E2E_WALLET, uiTokenAmount: { amount: "0" } }],
          postTokenBalances: [
            { accountIndex: 1, mint: USDC, owner: E2E_WALLET, uiTokenAmount: { amount: "12500000" } },
          ],
        },
        transaction: { message: { accountKeys: [{ pubkey: "E2ePayer", signer: true }] } },
      });
    default:
      return reply(null);
  }
}

/**
 * Stands in for OpenRouter's chat completions. It rejects requests that drift
 * from what the real check must send (policy first, JSON mode, no reasoning,
 * only providers that honour both),
 * so the tests catch a broken request, not just a broken reply.
 */
function startFakeCheck(): void {
  const log: FakeCheckRequest[] = [];
  const emails: FakeEmail[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/__requests") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(log));
      return;
    }
    // The same server stands in for Resend's batch API, for the daily digest.
    if (request.method === "GET" && request.url === "/__emails") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(emails));
      return;
    }
    if (request.method === "POST" && request.url === "/emails/batch") {
      const batch = JSON.parse(await readBody(request)) as FakeEmail[];
      if (request.headers.authorization !== "Bearer e2e-resend" || !request.headers["idempotency-key"]) {
        response.writeHead(401, { "content-type": "application/json" }).end('{"message":"bad key"}');
        return;
      }
      emails.push(...batch);
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ data: batch.map((_, n) => ({ id: `email-${emails.length - batch.length + n}` })) }));
      return;
    }
    // Embeddings, which Convex asks for when a slop is launched or edited, and for each search.
    if (request.method === "POST" && request.url === "/embeddings") {
      const { model, input } = JSON.parse(await readBody(request)) as { model?: string; input?: unknown };
      const texts = Array.isArray(input) && input.every((text) => typeof text === "string") ? input : null;
      if (request.headers.authorization !== "Bearer e2e-key" || model !== EMBEDDING_MODEL || !texts) {
        response.writeHead(400, { "content-type": "application/json" }).end('{"error":"malformed embeddings request"}');
        return;
      }
      const data = texts.map((text, index) => ({ object: "embedding", index, embedding: fakeEmbedding(text) }));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data }));
      return;
    }
    if (request.method === "POST" && request.url === "/solana") {
      const calls = JSON.parse(await readBody(request)) as RpcCall[];
      // Answer in reverse order: JSON-RPC batches may come back in any order.
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify(calls.map(fakeSolana).reverse()));
      return;
    }
    const body = JSON.parse(await readBody(request)) as {
      model: string;
      messages: {
        role: string;
        content:
          | string
          | {
              type: string;
              text?: string;
              image_url?: { url: string };
              video_url?: { url: string };
              file?: { filename?: string; file_data?: string };
            }[];
      }[];
      plugins?: { id?: string; pdf?: { engine?: string } }[];
      response_format?: { type: string };
      reasoning?: { enabled?: boolean };
      provider?: { require_parameters?: boolean };
    };
    const [system, user] = body.messages;
    // A product page draft: its own prompt, the slop as one JSON string.
    if (typeof system?.content === "string" && system.content.startsWith("You write the product page")) {
      const draft = {
        tagline: "Tilt your phone to roll a marble through a maze you drew",
        description: "Draw a maze with a finger, then tilt the phone to roll a marble home. Drafted for the e2e test.",
        features: [
          { title: "Draw any maze", body: "Sketch walls with a finger." },
          { title: "Tilt to roll", body: "The phone's tilt is the only control." },
        ],
        audience: "Anyone with a phone and five spare minutes",
      };
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(draft) } }] }));
      return;
    }
    const parts = Array.isArray(user?.content) ? user.content : [];
    const text = parts.map((part) => part.text ?? "").join("\n");
    // Images must arrive inline, as the real check sends them.
    const images = parts.flatMap((part) => (part.type === "image_url" ? [part.image_url?.url ?? ""] : []));
    const inline = images.map((url) => /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(url));
    // Videos too, and only the video check sends them.
    const videos = parts.flatMap((part) => (part.type === "video_url" ? [part.video_url?.url ?? ""] : []));
    const inlineVideos = videos.map((url) => /^data:video\/(mp4|webm);base64,([A-Za-z0-9+/=]+)$/.exec(url));
    // PDFs too, named, with the free text parser asked for.
    const files = parts.flatMap((part) => (part.type === "file" ? [part.file ?? {}] : []));
    const inlineFiles = files.map((file) =>
      file.filename ? /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/.exec(file.file_data ?? "") : null,
    );
    const parsesPdfs =
      files.length === 0 ||
      body.plugins?.some((plugin) => plugin.id === "file-parser" && plugin.pdf?.engine === "pdf-text");
    const wellFormed =
      request.headers.authorization === "Bearer e2e-key" &&
      system?.role === "system" &&
      typeof system.content === "string" &&
      system.content.includes("json") &&
      body.response_format?.type === "json_object" &&
      body.reasoning?.enabled === false &&
      body.provider?.require_parameters === true &&
      inline.every((match) => match !== null) &&
      inlineVideos.every((match) => match !== null) &&
      inlineFiles.every((match) => match !== null) &&
      parsesPdfs === true;
    if (!wellFormed) {
      response.writeHead(400, { "content-type": "application/json" }).end('{"error":"malformed check request"}');
      return;
    }
    // A video's markers are in its bytes, as if the model watched them, and a PDF's as if its text was read out.
    const watched = inlineVideos.map((match) => Buffer.from(match?.[2] ?? "", "base64").toString("latin1")).join("\n");
    const read = inlineFiles.map((match) => Buffer.from(match?.[1] ?? "", "base64").toString("latin1")).join("\n");
    const content = `${text}\n${watched}\n${read}`;
    const imageHashes = inline.map((match) => sha256Hex(Buffer.from(match?.[2] ?? "", "base64")));
    if (content.includes("[e2e:error]")) {
      log.push({
        model: body.model,
        text,
        images: images.length,
        videos: videos.length,
        files: files.length,
        imageHashes,
        verdict: null,
      });
      response.writeHead(502, { "content-type": "application/json" }).end('{"error":"upstream failed"}');
      return;
    }
    const verdict = content.includes("[e2e:blocked]") ? "blocked" : content.includes("[e2e:mature]") ? "mature" : "ok";
    log.push({
      model: body.model,
      text,
      images: images.length,
      videos: videos.length,
      files: files.length,
      imageHashes,
      verdict,
    });
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
  // `--` ends the options: a random base64url key can start with "-".
  const setEnv = (name: string, value: string) => run(convex, ["env", "set", "--env-file", envFile, "--", name, value]);
  setEnv("SLOPPER_JWT_ISSUER", APP_URL);
  setEnv("SLOPPER_JWKS", keys.jwks);
  setEnv("MEDIA_PUBLIC_URL", MEDIA_URL);
  setEnv("APP_URL", APP_URL);
  setEnv("RESEND_API_KEY", "e2e-resend");
  setEnv("RESEND_BASE_URL", CHECK_URL);
  setEnv("OPENROUTER_API_KEY", "e2e-key");
  setEnv("OPENROUTER_BASE_URL", CHECK_URL);
  const vapid = await generateVapidKeys();
  setEnv("VAPID_PUBLIC_KEY", vapid.publicKey);
  setEnv("VAPID_PRIVATE_KEY", vapid.privateKey);
  run(convex, ["deploy", "--env-file", envFile, "--codegen", "disable", "--typecheck", "disable"]);

  // 3. The content check and the bucket.
  startFakeCheck();
  startFakeS3(PORTS.s3, BUCKET, S3_CREDENTIALS);

  // 4. The production build, as Netlify runs it. Only this environment
  //    reaches it: never a checkout's .env.local.
  const app = spawn(process.execPath, ["scripts/serve.ts"], {
    cwd: ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PORT: String(PORTS.app),
      APP_URL,
      CONVEX_URL,
      // Analytics posts to the backend's HTTP actions, which a self-hosted backend serves on its own port.
      CONVEX_SITE_URL,
      SLOPPER_JWT_ISSUER: APP_URL,
      SLOPPER_JWT_PRIVATE_KEY: keys.privateKey,
      // The fake Solana RPC runs on loopback, which the SSRF-pinned transport
      // refuses everywhere else (app/.server/preview.ts).
      SLOPPER_ALLOW_LOCAL_FETCH: "1",
      SLOPPER_SECRET_KEY: randomBytes(32).toString("base64"),
      ADMIN_IDENTITIES: `${E2E_ADMIN_IDENTITY.provider}:${E2E_ADMIN_IDENTITY.providerId}`,
      OPENROUTER_API_KEY: "e2e-key",
      OPENROUTER_BASE_URL: CHECK_URL,
      SOLANA_RPC_URL: `${CHECK_URL}/solana`,
      VAPID_PUBLIC_KEY: vapid.publicKey,
      B2_ENDPOINT: S3_URL,
      B2_REGION: S3_CREDENTIALS.region,
      B2_BUCKET: BUCKET,
      B2_KEY_ID: S3_CREDENTIALS.keyId,
      B2_APPLICATION_KEY: S3_CREDENTIALS.secret,
      // Never called: the tests only check where the buttons send people.
      // Google stays unset, so a provider without keys stays hidden.
      GITHUB_CLIENT_ID: "e2e-github-client",
      GITHUB_CLIENT_SECRET: "e2e-github-secret",
      X_CLIENT_ID: "e2e-x-client",
      X_CLIENT_SECRET: "e2e-x-secret",
      LINKEDIN_CLIENT_ID: "e2e-linkedin-client",
      LINKEDIN_CLIENT_SECRET: "e2e-linkedin-secret",
      FACEBOOK_CLIENT_ID: "e2e-facebook-client",
      FACEBOOK_CLIENT_SECRET: "e2e-facebook-secret",
      // Comments stay off, as in production (COMMENTS_ENABLED unset).
    },
  });
  children.push(app);
  app.on("exit", (code) => code !== null && code !== 0 && stop(1));

  const stack: Stack = {
    appUrl: APP_URL,
    convexUrl: CONVEX_URL,
    convexSiteUrl: CONVEX_SITE_URL,
    checkUrl: CHECK_URL,
    s3Url: S3_URL,
    mediaUrl: MEDIA_URL,
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
