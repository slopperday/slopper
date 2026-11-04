import { parseCookie, stringifySetCookie } from "cookie";
import { type MiddlewareFunction, redirect as routerRedirect } from "react-router";
import type { Flash } from "~/lib/model";
import { REDIRECT_MARKER } from "~/lib/redirect";
import { config } from "./config";

export type { Flash };

export const SESSION_COOKIE = "slopper_session";
export const OAUTH_COOKIE = "slopper_oauth";
export const FLASH_COOKIE = "slopper_flash";
export const TZ_COOKIE = "slopper_tz";
/** A second-factor step in progress (app/.server/auth/twoFactor.ts). */
export const TWO_FACTOR_COOKIE = "slopper_2fa";

const secure = config.appUrl.protocol === "https:";

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  return header ? parseCookie(header)[name] : undefined;
}

export function setCookie(headers: Headers, name: string, value: string, maxAgeSeconds: number) {
  headers.append(
    "set-cookie",
    stringifySetCookie({
      name,
      value,
      maxAge: maxAgeSeconds,
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
    }),
  );
}

export function clearCookie(headers: Headers, name: string) {
  setCookie(headers, name, "", 0);
}

/** A redirect that carries a one-shot message for the next page. */
export function redirectWithFlash(location: string, flash?: Flash, headers = new Headers()): Response {
  if (flash) setCookie(headers, FLASH_COOKIE, encodeURIComponent(JSON.stringify(flash)), 60);
  return routerRedirect(location, { headers });
}

/**
 * The Location to send instead when Netlify would copy the request's query
 * string onto it (see ~/lib/redirect), or null when nothing needs to change.
 */
export function withOwnQuery(requestUrl: string, location: string): string | null {
  if (!new URL(requestUrl).search) return null;
  const hash = location.indexOf("#");
  const path = hash === -1 ? location : location.slice(0, hash);
  if (path.includes("?")) return null;
  return `${path}?${REDIRECT_MARKER}${hash === -1 ? "" : location.slice(hash)}`;
}

/** Keeps a request's query string, OAuth codes included, out of the redirect it gets. */
export const redirectQueryMiddleware: MiddlewareFunction<Response> = async ({ request }, next) => {
  const response = await next();
  const location = response.headers.get("location");
  const isRedirect = response.status >= 300 && response.status < 400;
  const replacement = isRedirect && location ? withOwnQuery(request.url, location) : null;
  if (replacement === null) return response;
  // Headers on some redirects are immutable (Response.redirect), so copy them.
  const headers = new Headers(response.headers);
  headers.set("location", replacement);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

export function readFlash(request: Request): Flash | null {
  const raw = readCookie(request, FLASH_COOKIE);
  if (!raw) return null;
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Partial<Flash>;
    if (typeof value.message !== "string") return null;
    const tone = value.tone === "success" || value.tone === "error" ? value.tone : "info";
    return { tone, message: value.message.slice(0, 300) };
  } catch {
    return null;
  }
}

/** Throws a 404 the root error boundary renders. */
export function notFound(): never {
  throw new Response("Not found", { status: 404 });
}

export function forbidden(): never {
  throw new Response("Forbidden", { status: 403 });
}

export function badRequest(message = "Bad request"): never {
  throw new Response(message, { status: 400 });
}

/**
 * Answers a form this server no longer reads, posted from a copy of `path`
 * loaded before a deploy changed it. Nothing happens; the person lands on the
 * current page with a note to try again, not on an error page.
 */
export function outOfDateForm(path: string): Response {
  return redirectWithFlash(path, {
    tone: "error",
    message: "That page was out of date, so nothing changed. Try again.",
  });
}

/** Login URL that brings the person back to `path` afterwards. */
export function loginUrl(path: string): string {
  return `/login?returnTo=${encodeURIComponent(path)}`;
}
