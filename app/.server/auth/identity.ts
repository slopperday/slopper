import type { LoginProvider, OAuthProviderId } from "~/lib/model";
import type { OAuthClientCredentials } from "../config";
import { encodeHex } from "../encoding";
import { FACEBOOK_GRAPH_VERSION, OAuthError } from "./oauth";

/**
 * Who is signing in, as each provider describes them. The `*Identity`
 * functions map a provider's profile; `fetchIdentity` asks for it.
 * An email suggests a username, and when the provider vouches for it, it's
 * kept for the daily digest (and nothing else).
 */

/** What a login provider tells us about the person signing in. */
export interface IdentityProfile {
  provider: LoginProvider;
  providerId: string;
  preferredUsername: string;
  displayName: string;
  avatarUrl: string | null;
  website?: string | null;
  bio?: string;
  /** Only an address the provider has verified belongs to this person. */
  email: string | null;
}

/** Lowercased, or null when it doesn't look like an address. */
function verifiedEmail(email: string | undefined | null, verified: boolean | undefined): string | null {
  const address = email?.trim().toLowerCase();
  return verified && address && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && address.length <= 254 ? address : null;
}

/**
 * LinkedIn and Facebook sign their picture URLs, and the signatures expire
 * within weeks. A new account keeps a copy of those instead of the link.
 */
export function avatarExpires(provider: LoginProvider): boolean {
  return provider === "linkedin" || provider === "facebook";
}

/** The part of an email address before the @, if there is one. */
function emailName(email: string | undefined): string | undefined {
  const name = email?.split("@")[0]?.trim();
  return name || undefined;
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  blog: string | null;
  bio: string | null;
}

/** One row of `GET /user/emails` (the `user:email` scope). */
export interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

export function githubIdentity(user: GitHubUser, emails: readonly GitHubEmail[] = []): IdentityProfile {
  const primary = emails.find((row) => row.primary);
  const blog = user.blog?.trim();
  return {
    provider: "github",
    providerId: String(user.id),
    preferredUsername: user.login,
    displayName: user.name ?? user.login,
    avatarUrl: user.avatar_url,
    bio: user.bio ?? "",
    website: blog ? (/^https?:\/\//.test(blog) ? blog : `https://${blog}`) : null,
    email: verifiedEmail(primary?.email, primary?.verified),
  };
}

export interface GoogleUser {
  sub: string;
  name?: string;
  given_name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
}

export function googleIdentity(user: GoogleUser): IdentityProfile {
  return {
    provider: "google",
    providerId: user.sub,
    preferredUsername: emailName(user.email) ?? user.given_name ?? "slopper",
    displayName: user.name ?? user.given_name ?? "New slopper",
    avatarUrl: user.picture ?? null,
    email: verifiedEmail(user.email, user.email_verified),
  };
}

/** `GET https://api.x.com/2/users/me`, inside its `data` envelope. X never shares an email. */
export interface XUser {
  id: string;
  username: string;
  name?: string;
  profile_image_url?: string;
}

export function xIdentity(user: XUser): IdentityProfile {
  return {
    provider: "x",
    providerId: user.id,
    preferredUsername: user.username,
    displayName: user.name?.trim() || user.username,
    // X serves a 48px "_normal" image by default; the same path has a 400px one.
    avatarUrl: user.profile_image_url?.replace(/_normal(\.\w+)$/, "_400x400$1") ?? null,
    email: null,
  };
}

/** LinkedIn's OpenID Connect userinfo. */
export interface LinkedInUser {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
}

export function linkedinIdentity(user: LinkedInUser): IdentityProfile {
  const fullName = user.name?.trim() || [user.given_name, user.family_name].filter(Boolean).join(" ");
  return {
    provider: "linkedin",
    providerId: user.sub,
    preferredUsername: emailName(user.email) ?? (fullName || "slopper"),
    displayName: fullName || "New slopper",
    avatarUrl: user.picture ?? null,
    email: verifiedEmail(user.email, user.email_verified),
  };
}

/** `GET /me?fields=id,name,picture.type(large),email` on the Graph API. */
export interface FacebookUser {
  id: string;
  name?: string;
  email?: string;
  picture?: { data?: { url?: string; is_silhouette?: boolean } };
}

export function facebookIdentity(user: FacebookUser): IdentityProfile {
  const picture = user.picture?.data;
  const name = user.name?.trim();
  return {
    provider: "facebook",
    // An app-scoped id: the same person has a different one in other apps.
    providerId: user.id,
    preferredUsername: emailName(user.email) ?? name ?? "slopper",
    displayName: name || "New slopper",
    // The grey default silhouette is no better than our initial.
    avatarUrl: picture?.url && !picture.is_silhouette ? picture.url : null,
    // Facebook only shares addresses its people have confirmed.
    email: verifiedEmail(user.email, true),
  };
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "user-agent": "slopper.day",
    },
  });
  if (!response.ok) {
    throw new OAuthError(`Profile request to ${new URL(url).host} failed (${response.status})`, response.status);
  }
  return (await response.json()) as T;
}

/**
 * Proves a Graph API call comes from this app's server, so a leaked user
 * token is useless elsewhere ("Require App Secret" in the app's settings).
 */
async function appSecretProof(accessToken: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return encodeHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(accessToken))));
}

/** Fetches the signed-in person's profile from a login provider. */
export async function fetchIdentity(
  provider: OAuthProviderId,
  accessToken: string,
  client: OAuthClientCredentials,
): Promise<IdentityProfile> {
  switch (provider) {
    case "github": {
      const [user, emails] = await Promise.all([
        getJson<GitHubUser>("https://api.github.com/user", accessToken),
        getJson<GitHubEmail[]>("https://api.github.com/user/emails", accessToken),
      ]);
      return githubIdentity(user, emails);
    }
    case "google":
      return googleIdentity(await getJson<GoogleUser>("https://openidconnect.googleapis.com/v1/userinfo", accessToken));
    case "x": {
      const { data } = await getJson<{ data: XUser }>(
        "https://api.x.com/2/users/me?user.fields=profile_image_url,name,username",
        accessToken,
      );
      return xIdentity(data);
    }
    case "linkedin":
      return linkedinIdentity(await getJson<LinkedInUser>("https://api.linkedin.com/v2/userinfo", accessToken));
    case "facebook": {
      const url = new URL(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me`);
      url.searchParams.set("fields", "id,name,picture.type(large),email");
      url.searchParams.set("appsecret_proof", await appSecretProof(accessToken, client.clientSecret));
      return facebookIdentity(await getJson<FacebookUser>(url.href, accessToken));
    }
  }
}
