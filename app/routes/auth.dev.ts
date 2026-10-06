import type { Route } from "./+types/auth.dev";
import { config } from "~/.server/config";
import { getKv } from "~/.server/kv";
import { createSession, upsertUserFromIdentity } from "~/.server/db/users";
import { safeReturnTo } from "~/.server/auth/oauth";
import { formText } from "~/.server/forms";
import { notFound, readCookie, redirectWithFlash, SESSION_COOKIE, setCookie, TZ_COOKIE } from "~/.server/http";

/** Password-less sign in for local development. 404s on Deno Deploy. */
export async function action({ request }: Route.ActionArgs) {
  if (!config.devLogin) notFound();
  const form = await request.formData();
  const username = formText(form, "username").toLowerCase();
  if (!/^[a-z0-9_-]{1,30}$/.test(username)) {
    return redirectWithFlash("/login", { tone: "error", message: "Use letters, numbers, - or _." });
  }
  const kv = await getKv();
  const { user } = await upsertUserFromIdentity(
    kv,
    { provider: "dev", providerId: username, preferredUsername: username, displayName: username, avatarUrl: null },
    decodeURIComponent(readCookie(request, TZ_COOKIE) ?? "UTC"),
  );
  const session = await createSession(kv, user.id);
  const response = redirectWithFlash(safeReturnTo(formText(form, "returnTo")));
  setCookie(response.headers, SESSION_COOKIE, session.token, session.maxAgeSeconds);
  return response;
}
