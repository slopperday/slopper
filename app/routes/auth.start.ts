import type { Route } from "./+types/auth.start";
import { allowAction, callerAddress } from "~/.server/tokens";
import { viewerContext } from "~/.server/session";
import {
  authorizationUrl,
  clientCredentials,
  INTENT_HOME,
  parseIntent,
  safeReturnTo,
  savePendingAuthorization,
} from "~/.server/auth/oauth";
import { requireRecentAuth } from "~/.server/auth/twoFactor";
import { randomToken } from "~/.server/encoding";
import { loginUrl, notFound, OAUTH_COOKIE, redirectWithFlash, setCookie } from "~/.server/http";
import { AUTH_LABELS, isAuthProvider } from "~/lib/model";

/**
 * Starts an OAuth flow: `/auth/<provider>?intent=login|link|connect`.
 * Without an intent, X and LinkedIn connect for auto-posting and the rest
 * sign in (see `parseIntent`).
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const provider = params.provider;
  if (!isAuthProvider(provider)) notFound();
  const search = new URL(request.url).searchParams;
  const intent = parseIntent(provider, search.get("intent"));
  if (!intent) notFound();
  const home = INTENT_HOME[intent];
  const client = clientCredentials(provider);
  if (!client) {
    return redirectWithFlash(home, {
      tone: "error",
      message:
        intent === "connect"
          ? `Connecting ${AUTH_LABELS[provider]} isn't available right now.`
          : `Signing in with ${AUTH_LABELS[provider]} isn't available right now.`,
    });
  }
  const viewer = context.get(viewerContext);
  // Linking and connecting add to the signed-in account.
  if (intent !== "login" && !viewer.user) return redirectWithFlash(loginUrl(home));
  // A new sign-in method or a connected account is a way in: whoever adds one proves it's them first.
  if (intent !== "login") await requireRecentAuth(viewer, request);

  // Each start is a Convex write, and the page is public: a flood of starts
  // must hit an address's ceiling, not the oauthStates table.
  if (!(await allowAction(`oauth-start:${callerAddress(request)}`, 30, 3_600_000))) {
    return redirectWithFlash(home, { tone: "error", message: "Too many sign-ins started. Try again in an hour." });
  }

  const state = randomToken();
  const codeVerifier = randomToken(48);
  await savePendingAuthorization(state, {
    provider,
    intent,
    codeVerifier,
    userId: viewer.user?._id ?? null,
    returnTo: intent === "login" ? safeReturnTo(search.get("returnTo")) : home,
  });

  const url = await authorizationUrl(provider, client, intent, state, codeVerifier);
  const headers = new Headers({ location: url.href });
  setCookie(headers, OAUTH_COOKIE, state, 600);
  return new Response(null, { status: 302, headers });
}
