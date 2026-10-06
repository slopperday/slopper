import type { LoginProvider } from "~/lib/model";
import { OAuthError } from "./oauth";

/** What a login provider tells us about the person signing in. */
export interface IdentityProfile {
  provider: LoginProvider;
  providerId: string;
  preferredUsername: string;
  displayName: string;
  avatarUrl: string | null;
  website?: string | null;
  bio?: string;
}

/** Fetches the signed-in person's profile from a login provider. */

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

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  blog: string | null;
  bio: string | null;
}

export async function fetchGitHubIdentity(accessToken: string): Promise<IdentityProfile> {
  const user = await getJson<GitHubUser>("https://api.github.com/user", accessToken);
  const blog = user.blog?.trim();
  return {
    provider: "github",
    providerId: String(user.id),
    preferredUsername: user.login,
    displayName: user.name ?? user.login,
    avatarUrl: user.avatar_url,
    bio: user.bio ?? "",
    website: blog ? (/^https?:\/\//.test(blog) ? blog : `https://${blog}`) : null,
  };
}

interface GoogleUser {
  sub: string;
  name?: string;
  given_name?: string;
  email?: string;
  picture?: string;
}

export async function fetchGoogleIdentity(accessToken: string): Promise<IdentityProfile> {
  const user = await getJson<GoogleUser>("https://openidconnect.googleapis.com/v1/userinfo", accessToken);
  return {
    provider: "google",
    providerId: user.sub,
    preferredUsername: user.email?.split("@")[0] ?? user.given_name ?? "slopper",
    displayName: user.name ?? user.given_name ?? "New slopper",
    avatarUrl: user.picture ?? null,
  };
}
