import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server.edge";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { config } from "./.server/config";
import { APP_VERSION } from "./lib/version";
import { VIDEO_FRAME_SOURCES } from "~/lib/video";

/**
 * Live queries open a websocket to Convex, and analytics posts to its HTTP
 * actions (`.convex.site`); the policy must allow both.
 */
function convexSources(): string {
  const sources: string[] = [];
  if (config.convexUrl) {
    const url = new URL(config.convexUrl);
    sources.push(url.origin, `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`);
  }
  if (config.analyticsEndpoint) sources.push(new URL(config.analyticsEndpoint).origin);
  return sources.map((source) => ` ${source}`).join("");
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
    // HTTPS only, from the first visit on: browsers stop asking over http at all.
    responseHeaders.set("strict-transport-security", "max-age=31536000; includeSubDomains");
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
        // Demo videos play in their host's player, loaded by a click; heatmaps draw Slopper's own pages.
        `frame-src 'self' ${VIDEO_FRAME_SOURCES.join(" ")}`,
        `connect-src 'self'${convexSources()}`,
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        // Only Slopper frames its own pages: the admins' heatmaps draw a page under its clicks.
        "frame-ancestors 'self'",
      ].join("; "),
    );
  }
  return new Response(body, { headers: responseHeaders, status });
}
