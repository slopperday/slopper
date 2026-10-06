/**
 * Deno Deploy entry point. Serves the built client assets and hands every
 * other request to the React Router server bundle.
 *
 *   vp build && deno run -A deploy/main.ts
 */
import { serveDir } from "jsr:@std/http@^1/file-server";
import { handler } from "../build/server/index.js";

const CLIENT_ROOT = new URL("../build/client", import.meta.url).pathname;

Deno.serve(async (request) => {
  const { pathname } = new URL(request.url);
  // Only paths that look like files are tried on disk; routes like
  // /feed.xml fall through to the app when no file matches.
  if ((request.method === "GET" || request.method === "HEAD") && /\.[a-z0-9]+$/i.test(pathname)) {
    const hashed = pathname.startsWith("/assets/");
    const response = await serveDir(request, {
      fsRoot: CLIENT_ROOT,
      quiet: true,
      headers: [hashed ? "cache-control: public, max-age=31536000, immutable" : "cache-control: public, max-age=3600"],
    });
    if (response.status !== 404) return response;
  }
  return await handler(request);
});
