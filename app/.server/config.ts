import process from "node:process";

/**
 * Runtime configuration, read once from the environment.
 *
 * Every integration is optional: a provider without credentials is not
 * offered in the UI, so a fresh checkout runs with nothing but `vp dev`.
 */

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface Config {
  /** Public origin used for OAuth redirects and absolute links. */
  appUrl: URL;
  /** True when running on Deno Deploy (`DENO_DEPLOY=true`). */
  isDeployed: boolean;
  /** Password-less local login for development. Never enabled on Deploy. */
  devLogin: boolean;
  /** Secret that derives the key encrypting third-party tokens at rest. */
  secretKey: string | null;
  /** Lower-cased usernames allowed to moderate content. */
  adminUsernames: ReadonlySet<string>;
  github: OAuthClientCredentials | null;
  google: OAuthClientCredentials | null;
  x: OAuthClientCredentials | null;
  linkedin: OAuthClientCredentials | null;
}

type Env = Record<string, string | undefined>;

function credentials(env: Env, prefix: string): OAuthClientCredentials | null {
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function loadConfig(env: Env = process.env): Config {
  const isDeployed = env.DENO_DEPLOY === "true";
  return {
    appUrl: new URL(env.APP_URL ?? "http://localhost:5173"),
    isDeployed,
    devLogin: !isDeployed && env.NODE_ENV !== "production" && env.DEV_LOGIN !== "false",
    secretKey: env.SLOPPER_SECRET_KEY?.trim() || null,
    adminUsernames: new Set(
      (env.ADMIN_USERNAMES ?? "")
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean),
    ),
    github: credentials(env, "GITHUB"),
    google: credentials(env, "GOOGLE"),
    x: credentials(env, "X"),
    linkedin: credentials(env, "LINKEDIN"),
  };
}

export const config: Config = loadConfig();

/** Absolute URL for a path on this site. */
export function absoluteUrl(path: string): string {
  return new URL(path, config.appUrl).href;
}
