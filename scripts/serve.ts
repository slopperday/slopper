/**
 * Serves the production build the way Netlify does: a file in build/client
 * when one matches, otherwise the React Router function that `vp build`
 * writes to .netlify/v1/functions. `vp run start` and the e2e stack use it.
 *
 *   vp build && node --env-file-if-exists=.env.local scripts/serve.ts
 */
import { createRequestListener } from "@remix-run/node-fetch-server";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const CLIENT = join(ROOT, "build", "client");
const FUNCTION = join(ROOT, ".netlify", "v1", "functions", "react-router-server.mjs");
const port = Number(process.env.PORT ?? 8000);

const TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const { default: handler } = (await import(pathToFileURL(FUNCTION).href)) as {
  default: (request: Request, context: object) => Promise<Response>;
};

/** The built file a GET or HEAD names, or null so the app handles it. */
async function staticFile(request: Request): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const path = join(CLIENT, decodeURIComponent(new URL(request.url).pathname));
  if (!path.startsWith(CLIENT + "/")) return null;
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return null;
  const headers = { "content-type": TYPES[extname(path)] ?? "application/octet-stream" };
  return new Response(request.method === "HEAD" ? null : await readFile(path), { headers });
}

const server = createServer(
  createRequestListener(async (request) => (await staticFile(request)) ?? (await handler(request, {}))),
);
server.listen(port, "127.0.0.1", () => console.log(`Serving build/ at http://127.0.0.1:${port}`));
