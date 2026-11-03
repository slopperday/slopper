import type { Route } from "./+types/auth.dev";
import { api } from "@convex/_generated/api";
import { config } from "~/.server/config";
import { convex } from "~/.server/convex";
import { grantListedAdmin, startSession } from "~/.server/session";
import { safeReturnTo } from "~/.server/auth/oauth";
import { secondFactorGate } from "~/.server/auth/twoFactor";
import { formText } from "~/.server/forms";
import { notFound, readCookie, redirectWithFlash, TZ_COOKIE } from "~/.server/http";

/** Password-less sign in for local development. 404s in production. */
export async function action({ request }: Route.ActionArgs) {
  if (!config.devLogin) notFound();
  const form = await request.formData();
  const username = formText(form, "username").toLowerCase();
  if (!/^[a-z0-9_-]{1,30}$/.test(username)) {
    return redirectWithFlash("/login", { tone: "error", message: "Use letters, numbers, - or _." });
  }
  const { userId } = await convex.mutation(api.users.upsertFromIdentity, {
    provider: "dev",
    providerId: username,
    preferredUsername: username,
    displayName: username,
    avatarUrl: null,
    timeZone: decodeURIComponent(readCookie(request, TZ_COOKIE) ?? "UTC"),
  });
  await grantListedAdmin({ provider: "dev", providerId: username });
  const returnTo = safeReturnTo(formText(form, "returnTo"));
  const gate = await secondFactorGate(userId, returnTo);
  if (gate) return gate;
  const response = redirectWithFlash(returnTo);
  await startSession(userId, response.headers, { verified: true, userAgent: request.headers.get("user-agent") });
  return response;
}
