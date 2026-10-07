import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { parseEnv } from "node:util";

// Local development keeps secrets and the Convex URL in `.env.local`
// (written by `convex dev` and scripts/convex-keys.ts). Variables already in
// the environment win, as with Node's `--env-file`. Deno's
// `process.loadEnvFile` overwrites them instead, which let a checkout's
// `.env.local` replace the keys the e2e stack gives its production server.
if (process.env.DENO_DEPLOY !== "true" && existsSync(".env.local")) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(".env.local", "utf8")))) {
    process.env[key] ??= value;
  }
}

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

export interface ContentCheckConfig {
  apiKey: string;
  /** OpenAI-compatible endpoint; DeepSeek by default. */
  baseUrl: string;
  model: string;
}

export interface Config {
  /** Public origin used for OAuth redirects and absolute links. */
  appUrl: URL;
  /** True when running on Deno Deploy (`DENO_DEPLOY=true`). */
  isDeployed: boolean;
  /**
   * Password-less local login. Only the Vite dev server can turn it on: a
   * production bundle compiles it out, whatever its environment says.
   */
  devLogin: boolean;
  /** Secret that derives the key encrypting third-party tokens at rest. */
  secretKey: string | null;
  /** Convex deployment URL. */
  convexUrl: string | null;
  /** Issuer and private key for the JWTs Convex trusts. */
  jwtIssuer: string;
  jwtPrivateKey: string | null;
  /** Lower-cased usernames allowed to moderate content. */
  adminUsernames: ReadonlySet<string>;
  github: OAuthClientCredentials | null;
  google: OAuthClientCredentials | null;
  x: OAuthClientCredentials | null;
  linkedin: OAuthClientCredentials | null;
  /** Automated content check. Without it, nothing is ever auto-posted. */
  contentCheck: ContentCheckConfig | null;
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
    devLogin: import.meta.env.DEV && !isDeployed && env.DEV_LOGIN !== "false",
    secretKey: env.SLOPPER_SECRET_KEY?.trim() || null,
    convexUrl: env.CONVEX_URL?.trim() || env.VITE_CONVEX_URL?.trim() || null,
    jwtIssuer: env.SLOPPER_JWT_ISSUER?.trim() || "https://slopper.day",
    jwtPrivateKey: env.SLOPPER_JWT_PRIVATE_KEY?.trim() || null,
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
    contentCheck: env.DEEPSEEK_API_KEY?.trim()
      ? {
          apiKey: env.DEEPSEEK_API_KEY.trim(),
          baseUrl: env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
          model: env.DEEPSEEK_MODEL?.trim() || "deepseek-flash",
        }
      : null,
  };
}

export const config: Config = loadConfig();

/** Absolute URL for a path on this site. */
export function absoluteUrl(path: string): string {
  return new URL(path, config.appUrl).href;
}
