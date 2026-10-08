import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { isOAuthProvider, OAUTH_LABELS, type OAuthProviderId } from "~/lib/model";
import { convex } from "../convex";
import { encodeBase64Url } from "../encoding";
import { absoluteUrl, config, type OAuthClientCredentials } from "../config";

/**
 * A small OAuth 2.0 authorization-code client. Every provider signs people
 * in; X and LinkedIn also connect accounts for auto-posting. Each provider
 * has one redirect URI whatever the flow: the flow is kept server-side with
 * the pending authorization, never in the URL.
 */

/**
 * Why a flow started:
 * - `login`: sign in, creating an account the first time;
 * - `link`: add a sign-in method to the signed-in account;
 * - `connect`: connect an account to auto-post to.
 */
export type OAuthIntent = "login" | "link" | "connect";

/** The page each flow starts from, and comes back to when it fails. */
export const INTENT_HOME: Record<OAuthIntent, string> = {
  login: "/login",
  link: "/settings",
  connect: "/settings/autopost",
};

/** Meta versions the Graph API, and each version lives about two years. */
export const FACEBOOK_GRAPH_VERSION = "v26.0";

interface ProviderSpec {
  authorizeUrl: string;
  tokenUrl: string;
  /** Scopes to sign in or link: just enough to know who the person is. */
  loginScopes: readonly string[];
  /** Scopes to connect for auto-posting. Absent when the provider only signs in. */
  connectScopes?: readonly string[];
  pkce: boolean;
  /** How the client authenticates at the token endpoint. */
  clientAuth: "basic" | "body";
  extraParams?: Record<string, string>;
}

const PROVIDERS: Record<OAuthProviderId, ProviderSpec> = {
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    loginScopes: ["read:user", "user:email"],
    pkce: true,
    clientAuth: "body",
  },
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    loginScopes: ["openid", "email", "profile"],
    pkce: true,
    clientAuth: "body",
    extraParams: { prompt: "select_account" },
  },
  x: {
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    // Reading /2/users/me needs both. Signing in never asks to post or for
    // a refresh token.
    loginScopes: ["users.read", "tweet.read"],
    connectScopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    pkce: true,
    clientAuth: "basic",
  },
  linkedin: {
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    // Sign In with LinkedIn using OpenID Connect.
    loginScopes: ["openid", "profile", "email"],
    connectScopes: ["openid", "profile", "w_member_social"],
    // LinkedIn's web flow authenticates with the client secret instead.
    pkce: false,
    clientAuth: "body",
  },
  facebook: {
    authorizeUrl: `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`,
    // Documented as a GET; it takes the same parameters as a form POST,
    // which keeps the app secret out of URLs and logs.
    tokenUrl: `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`,
    loginScopes: ["public_profile", "email"],
    // Facebook Login checks a PKCE verifier on top of the app secret.
    pkce: true,
    clientAuth: "body",
  },
};

export function clientCredentials(provider: OAuthProviderId): OAuthClientCredentials | null {
  return config[provider];
}

/**
 * The flow `/auth/<provider>?intent=…` asks for, or null when the provider
 * can't do it. Without an intent, a provider that connects accounts
 * connects: that is all `/auth/x` and `/auth/linkedin` did before X and
 * LinkedIn could sign people in, and existing links still mean it.
 */
export function parseIntent(provider: OAuthProviderId, value: string | null): OAuthIntent | null {
  const canConnect = PROVIDERS[provider].connectScopes !== undefined;
  const intent = value ?? (canConnect ? "connect" : "login");
  switch (intent) {
    case "login":
    case "link":
      return intent;
    case "connect":
      return canConnect ? intent : null;
    default:
      return null;
  }
}

export function redirectUri(provider: OAuthProviderId): string {
  return absoluteUrl(`/auth/${provider}/callback`);
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** ISO timestamp, or null when the provider does not say. */
  expiresAt: string | null;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return encodeBase64Url(new Uint8Array(digest));
}

export async function authorizationUrl(
  provider: OAuthProviderId,
  client: OAuthClientCredentials,
  intent: OAuthIntent,
  state: string,
  codeVerifier: string,
): Promise<URL> {
  const spec = PROVIDERS[provider];
  const scopes = intent === "connect" ? spec.connectScopes : spec.loginScopes;
  if (!scopes) throw new OAuthError(`${OAUTH_LABELS[provider]} can't connect accounts for auto-posting.`);
  const url = new URL(spec.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", redirectUri(provider));
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  if (spec.pkce) {
    url.searchParams.set("code_challenge", await codeChallenge(codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [name, value] of Object.entries(spec.extraParams ?? {})) {
    url.searchParams.set(name, value);
  }
  return url;
}

/**
 * The reason in a token endpoint's error body. Most providers send
 * `error` and `error_description` strings; Facebook sends an `error`
 * object with a `message`.
 */
function errorDetail(json: Record<string, unknown>): string | null {
  const { error, error_description: description } = json;
  if (typeof description === "string") return description;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return null;
}

async function tokenRequest(
  provider: OAuthProviderId,
  client: OAuthClientCredentials,
  params: Record<string, string>,
): Promise<TokenSet> {
  const spec = PROVIDERS[provider];
  const label = OAUTH_LABELS[provider];
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (spec.clientAuth === "basic") {
    headers.authorization = `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`;
    body.set("client_id", client.clientId);
  } else {
    body.set("client_id", client.clientId);
    body.set("client_secret", client.clientSecret);
  }

  const response = await fetch(spec.tokenUrl, {
    method: "POST",
    headers,
    body,
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  // GitHub reports errors with a 200 status and an `error` field.
  if (!response.ok || typeof json.error === "string") {
    throw new OAuthError(`${label} token request failed: ${errorDetail(json) ?? response.statusText}`, response.status);
  }
  if (typeof json.access_token !== "string") {
    throw new OAuthError(`${label} returned no access token`);
  }
  const expiresIn = Number(json.expires_in);
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
  };
}

export function exchangeCode(
  provider: OAuthProviderId,
  client: OAuthClientCredentials,
  code: string,
  codeVerifier: string,
): Promise<TokenSet> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(provider),
  };
  if (PROVIDERS[provider].pkce) params.code_verifier = codeVerifier;
  return tokenRequest(provider, client, params);
}

export function refreshTokens(
  provider: OAuthProviderId,
  client: OAuthClientCredentials,
  refreshToken: string,
): Promise<TokenSet> {
  return tokenRequest(provider, client, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/** Server-side record of an in-flight authorization, keyed by `state`. */
export interface PendingAuthorization {
  provider: OAuthProviderId;
  intent: OAuthIntent;
  codeVerifier: string;
  /** Who started a `link` or `connect` flow; the browser finishing it must be them. */
  userId: Id<"users"> | null;
  returnTo: string;
}

export async function savePendingAuthorization(state: string, pending: PendingAuthorization): Promise<void> {
  await convex.mutation(api.oauth.save, { state, ...pending });
}

/** Reads and deletes the pending authorization, so a state works once. */
export async function takePendingAuthorization(state: string): Promise<PendingAuthorization | null> {
  const pending = await convex.mutation(api.oauth.take, { state });
  if (!pending || !isOAuthProvider(pending.provider)) return null;
  return { ...pending, provider: pending.provider };
}

/** Only same-site relative paths are allowed as post-login destinations. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
