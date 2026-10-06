import type { Kv } from "@deno/kv";
import { encodeBase64Url } from "../encoding";
import { absoluteUrl, config, type OAuthClientCredentials } from "../config";

/**
 * A small OAuth 2.0 authorization-code client. Four providers share it:
 * GitHub and Google for signing in, X and LinkedIn for connecting accounts.
 */

export type OAuthProviderId = "github" | "google" | "x" | "linkedin";

interface ProviderSpec {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: readonly string[];
  pkce: boolean;
  /** How the client authenticates at the token endpoint. */
  clientAuth: "basic" | "body";
  extraParams?: Record<string, string>;
}

const PROVIDERS: Record<OAuthProviderId, ProviderSpec> = {
  github: {
    label: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["read:user", "user:email"],
    pkce: true,
    clientAuth: "body",
  },
  google: {
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["openid", "email", "profile"],
    pkce: true,
    clientAuth: "body",
    extraParams: { prompt: "select_account" },
  },
  x: {
    label: "X",
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    scopes: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    pkce: true,
    clientAuth: "basic",
  },
  linkedin: {
    label: "LinkedIn",
    authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    scopes: ["openid", "profile", "w_member_social"],
    // LinkedIn's web flow authenticates with the client secret instead.
    pkce: false,
    clientAuth: "body",
  },
};

export function isOAuthProvider(value: string): value is OAuthProviderId {
  return Object.hasOwn(PROVIDERS, value);
}

export function providerLabel(provider: OAuthProviderId): string {
  return PROVIDERS[provider].label;
}

export function clientCredentials(provider: OAuthProviderId): OAuthClientCredentials | null {
  return config[provider];
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
  state: string,
  codeVerifier: string,
): Promise<URL> {
  const spec = PROVIDERS[provider];
  const url = new URL(spec.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", redirectUri(provider));
  url.searchParams.set("scope", spec.scopes.join(" "));
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

async function tokenRequest(
  provider: OAuthProviderId,
  client: OAuthClientCredentials,
  params: Record<string, string>,
): Promise<TokenSet> {
  const spec = PROVIDERS[provider];
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
    const detail =
      [json.error_description, json.error].find((value): value is string => typeof value === "string") ??
      response.statusText;
    throw new OAuthError(`${spec.label} token request failed: ${detail}`, response.status);
  }
  if (typeof json.access_token !== "string") {
    throw new OAuthError(`${spec.label} returned no access token`);
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

export type OAuthIntent = "login" | "connect";

/** Server-side record of an in-flight authorization, keyed by `state`. */
export interface PendingAuthorization {
  provider: OAuthProviderId;
  intent: OAuthIntent;
  codeVerifier: string;
  userId: string | null;
  returnTo: string;
}

const PENDING_TTL_MS = 10 * 60_000;

export async function savePendingAuthorization(kv: Kv, state: string, pending: PendingAuthorization): Promise<void> {
  await kv.set(["oauth", state], pending, { expireIn: PENDING_TTL_MS });
}

/** Reads and deletes the pending authorization, so a state works once. */
export async function takePendingAuthorization(kv: Kv, state: string): Promise<PendingAuthorization | null> {
  const entry = await kv.get<PendingAuthorization>(["oauth", state]);
  if (!entry.value) return null;
  const result = await kv.atomic().check(entry).delete(entry.key).commit();
  return result.ok ? entry.value : null;
}

/** Only same-site relative paths are allowed as post-login destinations. */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
