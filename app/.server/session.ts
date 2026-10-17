import { createContext, type MiddlewareFunction, redirect } from "react-router";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { canModerate, isAdmin, type StaffRole } from "@convex/lib/auth";
import type { Flash } from "~/lib/model";
import { isValidTimeZone } from "~/lib/dates";
import { config } from "./config";
import { convex } from "./convex";
import { hashToken, randomToken } from "./encoding";
import {
  clearCookie,
  FLASH_COOKIE,
  loginUrl,
  notFound,
  readCookie,
  readFlash,
  SESSION_COOKIE,
  setCookie,
  TZ_COOKIE,
} from "./http";

export type User = Doc<"users">;

/**
 * Who is asking, resolved once per request by the root middleware. Their
 * moderation role is on `user.role`: check it with `canModerate` and
 * `isAdmin` (convex/lib/auth.ts), or `requireStaff`.
 */
export interface Viewer {
  user: User | null;
  /** The signed-in person's zone, or the browser's guess for visitors. */
  timeZone: string;
  flash: Flash | null;
}

export const viewerContext = createContext<Viewer>({
  user: null,
  timeZone: "UTC",
  flash: null,
});

const SESSION_TTL_MS = 30 * 86_400_000;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Rejects cross-site form posts. Browsers send `Sec-Fetch-Site`; older ones
 * fall back to `Origin`. Session cookies are also `SameSite=Lax`.
 */
export const csrfMiddleware: MiddlewareFunction<Response> = async ({ request }, next) => {
  // Bearer-token calls (REST, MCP) never use cookies, so another site can't
  // forge them; browsers can't send that header cross-site without CORS.
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
  const token = readCookie(request, SESSION_COOKIE);
  let user = token ? await convex.query(api.users.resolveSession, { tokenHash: await hashToken(token) }) : null;
  // ADMIN_USERNAMES are always admins. The first time the server sees one,
  // Convex stores it too, so Convex checks their role like anyone else's.
  if (user && config.adminUsernames.has(user.username.toLowerCase()) && user.role !== "admin") {
    await convex.mutation(api.team.bootstrap, { userId: user._id });
    user = { ...user, role: "admin" };
  }
  const browserZone = decodeURIComponent(readCookie(request, TZ_COOKIE) ?? "");
  const flash = readFlash(request);
  context.set(viewerContext, {
    user,
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

/**
 * The signed-in moderator (anyone on the team) or admin. Everyone else gets a
 * 404, not a 403: nobody else needs to know the moderation pages exist.
 */
export function requireStaff(viewer: Viewer, request: Request, role: StaffRole): User {
  const user = requireUser(viewer, request);
  if (role === "admin" ? !isAdmin(user) : !canModerate(user)) notFound();
  return user;
}

/** Starts a session and sets its cookie on `headers`. */
export async function startSession(userId: Id<"users">, headers: Headers): Promise<void> {
  const token = randomToken();
  await convex.mutation(api.users.createSession, {
    userId,
    tokenHash: await hashToken(token),
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  setCookie(headers, SESSION_COOKIE, token, SESSION_TTL_MS / 1000);
}

export async function endSession(request: Request, headers: Headers): Promise<void> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await convex.mutation(api.users.deleteSession, { tokenHash: await hashToken(token) });
  clearCookie(headers, SESSION_COOKIE);
}
