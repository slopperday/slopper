import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server.edge";
import type { EntryContext, HandleErrorFunction, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { config } from "./.server/config";
import { contentSecurityPolicy } from "./.server/csp";
import { reportServerError } from "./.server/errors";
import { viewerContext } from "./.server/session";
import { APP_VERSION } from "./lib/version";
import { VIDEO_FRAME_SOURCES } from "~/lib/video";

/**
 * Live queries open a websocket to Convex, and analytics posts to its HTTP
 * actions (`.convex.site`); the policy must allow both.
 */
function convexSources(): string[] {
  const sources: string[] = [];
  if (config.convexUrl) {
    const url = new URL(config.convexUrl);
    const websocket = url.protocol === "https:" ? "wss:" : "ws:";
    sources.push(url.origin, `${websocket}//${url.host}`);
  }
  if (config.analyticsEndpoint) sources.push(new URL(config.analyticsEndpoint).origin);
  return sources;
}

/**
 * Web-streams rendering so the same server bundle runs on Node in
 * development and in Netlify Functions in production. Bots get the full document.
 */
/**
 * Errors in loaders, actions and rendering: logged, and recorded in
 * analytics. A request the visitor walked away from isn't an error.
 */
export const handleError: HandleErrorFunction = (error, { request, context }) => {
  if (request.signal.aborted) return;
  console.error(error);
  void reportServerError(error, request, context.get(viewerContext).user?._id ?? null);
};

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
): Promise<Response> {
  let status = responseStatusCode;
  // A nonce per response: React Router streams hydration data as inline
  // scripts, and this reaches them (and the CSP header below) so no other
  // inline script ever runs.
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} nonce={nonce} />, {
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
    // Images and promo videos come from the B2 bucket (or Convex storage) and sign-in providers, all https.
    responseHeaders.set(
      "content-security-policy",
      contentSecurityPolicy(nonce, {
        convex: convexSources(),
        frames: VIDEO_FRAME_SOURCES,
      }),
    );
  }
  return new Response(body, { headers: responseHeaders, status });
}
