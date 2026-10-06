import type { Route } from "./+types/auth.start";
import { getKv } from "~/.server/kv";
import { viewerContext } from "~/.server/session";
import {
  authorizationUrl,
  clientCredentials,
  isOAuthProvider,
  type OAuthIntent,
  providerLabel,
  safeReturnTo,
  savePendingAuthorization,
} from "~/.server/auth/oauth";
import { randomToken } from "~/.server/encoding";
import { loginUrl, notFound, OAUTH_COOKIE, redirectWithFlash, setCookie } from "~/.server/http";

const INTENTS: Record<string, OAuthIntent> = {
  github: "login",
  google: "login",
  x: "connect",
  linkedin: "connect",
};

/** Starts an OAuth flow: sign in (GitHub, Google) or connect (X, LinkedIn). */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const provider = params.provider;
  if (!isOAuthProvider(provider)) notFound();
  const intent = INTENTS[provider];
  const client = clientCredentials(provider);
  if (!client) {
    return redirectWithFlash(intent === "login" ? "/login" : "/settings/autopost", {
      tone: "error",
      message: `${providerLabel(provider)} isn't set up on this server yet.`,
    });
  }
  const viewer = context.get(viewerContext);
  if (intent === "connect" && !viewer.user) return redirectWithFlash(loginUrl("/settings/autopost"));

  const state = randomToken();
  const codeVerifier = randomToken(48);
  await savePendingAuthorization(await getKv(), state, {
    provider,
    intent,
    codeVerifier,
    userId: viewer.user?.id ?? null,
    returnTo: safeReturnTo(new URL(request.url).searchParams.get("returnTo")),
  });

  const url = await authorizationUrl(provider, client, state, codeVerifier);
  const headers = new Headers({ location: url.href });
  setCookie(headers, OAUTH_COOKIE, state, 600);
  return new Response(null, { status: 302, headers });
}
