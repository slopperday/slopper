import type { Kv } from "@deno/kv";
import type { Route } from "./+types/auth.callback";
import { getKv } from "~/.server/kv";
import { viewerContext } from "~/.server/session";
import {
  clientCredentials,
  exchangeCode,
  isOAuthProvider,
  type OAuthProviderId,
  type PendingAuthorization,
  providerLabel,
  takePendingAuthorization,
  type TokenSet,
} from "~/.server/auth/oauth";
import { fetchGitHubIdentity, fetchGoogleIdentity } from "~/.server/auth/identity";
import { createSession, upsertUserFromIdentity } from "~/.server/db/users";
import { connectAccount } from "~/.server/db/accounts";
import { fetchLinkedInProfile, fetchXProfile, sealCredentials } from "~/.server/social/adapters";
import {
  clearCookie,
  notFound,
  OAUTH_COOKIE,
  readCookie,
  redirectWithFlash,
  SESSION_COOKIE,
  setCookie,
  TZ_COOKIE,
} from "~/.server/http";

const EXPIRED = { tone: "error", message: "That sign-in link expired. Try again." } as const;

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const provider = params.provider;
  if (!isOAuthProvider(provider)) notFound();
  const label = providerLabel(provider);
  const search = new URL(request.url).searchParams;
  const state = search.get("state") ?? "";
  const code = search.get("code");

  if (search.has("error")) {
    return redirectWithFlash("/login", { tone: "info", message: `${label} sign-in was cancelled.` });
  }
  // The state must match the cookie set on this browser when the flow began.
  if (!code || !state || readCookie(request, OAUTH_COOKIE) !== state) return redirectWithFlash("/login", EXPIRED);

  const kv = await getKv();
  const pending = await takePendingAuthorization(kv, state);
  const client = clientCredentials(provider);
  if (!pending || pending.provider !== provider || !client) return redirectWithFlash("/login", EXPIRED);
  const fallback = pending.intent === "login" ? "/login" : "/settings/autopost";

  let response: Response;
  try {
    const tokens = await exchangeCode(provider, client, code, pending.codeVerifier);
    response =
      pending.intent === "login"
        ? await completeLogin(request, kv, provider, tokens, pending)
        : await completeConnect(kv, provider, tokens, pending, context.get(viewerContext).user?.id);
  } catch (error) {
    console.error(`OAuth ${pending.intent} failed for ${provider}`, error);
    response = redirectWithFlash(fallback, {
      tone: "error",
      message: `Couldn't finish with ${label}: ${error instanceof Error ? error.message : "unknown error"}`,
    });
  }
  clearCookie(response.headers, OAUTH_COOKIE);
  return response;
}

async function completeLogin(
  request: Request,
  kv: Kv,
  provider: OAuthProviderId,
  tokens: TokenSet,
  pending: PendingAuthorization,
): Promise<Response> {
  const profile =
    provider === "github"
      ? await fetchGitHubIdentity(tokens.accessToken)
      : await fetchGoogleIdentity(tokens.accessToken);
  const timeZone = decodeURIComponent(readCookie(request, TZ_COOKIE) ?? "UTC");
  const { user, created } = await upsertUserFromIdentity(kv, profile, timeZone);
  const session = await createSession(kv, user.id);
  const response = created
    ? redirectWithFlash("/goal", {
        tone: "success",
        message: `Welcome, @${user.username}. Set a goal and start slopping.`,
      })
    : redirectWithFlash(pending.returnTo);
  setCookie(response.headers, SESSION_COOKIE, session.token, session.maxAgeSeconds);
  return response;
}

async function completeConnect(
  kv: Kv,
  provider: OAuthProviderId,
  tokens: TokenSet,
  pending: PendingAuthorization,
  currentUserId: string | undefined,
): Promise<Response> {
  // The browser that finishes the flow must belong to whoever started it.
  if (!pending.userId || pending.userId !== currentUserId) {
    return redirectWithFlash("/login", { tone: "error", message: "Sign in again to connect accounts." });
  }

  if (provider === "x") {
    const profile = await fetchXProfile(tokens.accessToken);
    const account = await connectAccount(kv, pending.userId, {
      provider: "x",
      remoteId: profile.id,
      handle: profile.username,
      displayName: profile.name,
      avatarUrl: profile.profile_image_url ?? null,
      sealedCredentials: await sealCredentials({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      }),
      expiresAt: null,
    });
    return redirectWithFlash("/settings/autopost", { tone: "success", message: `Connected @${account.handle} on X.` });
  }

  const profile = await fetchLinkedInProfile(tokens.accessToken);
  const account = await connectAccount(kv, pending.userId, {
    provider: "linkedin",
    remoteId: profile.sub,
    handle: profile.name ?? profile.given_name ?? "LinkedIn member",
    displayName: profile.name ?? "LinkedIn member",
    avatarUrl: profile.picture ?? null,
    sealedCredentials: await sealCredentials({
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      personUrn: `urn:li:person:${profile.sub}`,
    }),
    expiresAt: tokens.expiresAt,
  });
  return redirectWithFlash("/settings/autopost", {
    tone: "success",
    message: `Connected ${account.displayName} on LinkedIn.`,
  });
}
