import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server.edge";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { config } from "./.server/config";
import { APP_VERSION } from "./lib/version";

/** Live queries open a websocket to Convex; the policy must allow it. */
function convexSources(): string {
  if (!config.convexUrl) return "";
  const url = new URL(config.convexUrl);
  const socket = `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`;
  return ` ${url.origin} ${socket}`;
}

/**
 * Web-streams rendering so the same server bundle runs on Node in
 * development and in Netlify Functions in production. Bots get the full document.
 */
export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
): Promise<Response> {
  let status = responseStatusCode;
  const body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />, {
    signal: request.signal,
    onError(error: unknown) {
      status = 500;
      console.error(error);
    },
  });
  if (isbot(request.headers.get("user-agent") ?? "")) await body.allReady;

  responseHeaders.set("content-type", "text/html; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  responseHeaders.set("referrer-policy", "strict-origin-when-cross-origin");
  // `node scripts/release.ts publish` waits for slopper.day to report the new release here.
  responseHeaders.set("x-slopper-version", APP_VERSION);
  if (import.meta.env.PROD) {
    // Inline scripts stay allowed: React Router streams hydration data with
    // them. Inline styles too: cards set CSS variables for their tilt.
    // Images and promo videos come from the B2 bucket (or Convex storage) and sign-in providers, all https.
    responseHeaders.set(
      "content-security-policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https:",
        `connect-src 'self'${convexSources()}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join("; "),
    );
  }
  return new Response(body, { headers: responseHeaders, status });
}
