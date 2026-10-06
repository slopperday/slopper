import { createContext, redirect, type MiddlewareFunction } from "react-router";
import type { User } from "~/lib/model";
import { isValidTimeZone } from "~/lib/dates";
import { config } from "./config";
import { getKv } from "./kv";
import { getSessionUser } from "./db/users";
import {
  clearCookie,
  FLASH_COOKIE,
  type Flash,
  loginUrl,
  readCookie,
  readFlash,
  SESSION_COOKIE,
  TZ_COOKIE,
} from "./http";

/** Who is asking, resolved once per request by the root middleware. */
export interface Viewer {
  user: User | null;
  isAdmin: boolean;
  /** The signed-in person's zone, or the browser's guess for visitors. */
  timeZone: string;
  flash: Flash | null;
}

export const viewerContext = createContext<Viewer>({
  user: null,
  isAdmin: false,
  timeZone: "UTC",
  flash: null,
});

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Rejects cross-site form posts. Browsers send `Sec-Fetch-Site`; older ones
 * fall back to `Origin`. Session cookies are also `SameSite=Lax`.
 */
export const csrfMiddleware: MiddlewareFunction<Response> = async ({ request }, next) => {
  // Bearer-token calls (REST, MCP) never use cookies, so they can't be forged
  // by another site; browsers can't send that header cross-site without CORS.
  const bearer = request.headers.get("authorization")?.startsWith("Bearer ") ?? false;
  if (!SAFE_METHODS.has(request.method) && !bearer) {
    const site = request.headers.get("sec-fetch-site");
    const origin = request.headers.get("origin");
    const sameOrigin = origin === null || origin === new URL(request.url).origin;
    const allowed = site === null ? sameOrigin : site === "same-origin" || site === "none" || sameOrigin;
    if (!allowed) throw new Response("Cross-site request blocked", { status: 403 });
  }
  return await next();
};

export const viewerMiddleware: MiddlewareFunction<Response> = async ({ request, context }, next) => {
  const pathname = new URL(request.url).pathname;
  // Images never depend on who is looking; skip the session read.
  if (pathname.startsWith("/media/")) return await next();

  const token = readCookie(request, SESSION_COOKIE);
  const user = token ? await getSessionUser(await getKv(), token) : null;
  const browserZone = decodeURIComponent(readCookie(request, TZ_COOKIE) ?? "");
  const flash = readFlash(request);
  context.set(viewerContext, {
    user,
    isAdmin: user !== null && config.adminUsernames.has(user.username.toLowerCase()),
    timeZone: user?.timeZone ?? (isValidTimeZone(browserZone) ? browserZone : "UTC"),
    flash,
  });

  const response = await next();
  const isRedirect = response.status >= 300 && response.status < 400;
  if (flash && !isRedirect) clearCookie(response.headers, FLASH_COOKIE);
  return response;
};

/** The signed-in user, or a redirect to the login page. */
export function requireUser(viewer: Viewer, request: Request): User {
  if (viewer.user) return viewer.user;
  const url = new URL(request.url);
  throw redirect(loginUrl(url.pathname + url.search));
}
