import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { parseEnv } from "node:util";

// The Vite dev server reads secrets and the Convex URL from `.env.local`
// (written by `convex dev` and scripts/convex-keys.ts). Variables already in
// the environment win, as with Node's `--env-file`. A production build never
// reads it: Netlify sets the environment, and so do `vp run start` and the e2e stack.
if (import.meta.env.DEV && existsSync(".env.local")) {
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

/**
 * The content check goes through OpenRouter, so switching models is a
 * config change, not a code change.
 */
export interface ContentCheckConfig {
  apiKey: string;
  /** OpenRouter, or anything that speaks its chat completions API (the e2e fake). */
  baseUrl: string;
  /** Any OpenRouter model that reads images and supports JSON mode. */
  model: string;
  /**
   * The provider OpenRouter tries first. DeepSeek serves the full model with
   * the cheapest cache reads; others take over when it's down, and a model
   * it doesn't serve skips it.
   */
  provider: string;
}

/**
 * A Backblaze B2 bucket for screenshots, through its S3-compatible API. The
 * public URL images are served from (MEDIA_PUBLIC_URL) is set on Convex,
 * which builds image URLs; the app server only writes and deletes objects.
 */
export interface B2Config {
  /** S3 endpoint, e.g. https://s3.us-west-004.backblazeb2.com. No trailing slash. */
  endpoint: string;
  /** The endpoint's region, e.g. us-west-004. */
  region: string;
  bucket: string;
  keyId: string;
  applicationKey: string;
}

export interface Config {
  /** Public origin used for OAuth redirects and absolute links. */
  appUrl: URL;
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
  facebook: OAuthClientCredentials | null;
  /** Automated content check. Without it, nothing is ever auto-posted. */
  contentCheck: ContentCheckConfig | null;
  /**
   * Feedback and kudos on slops (`COMMENTS_ENABLED=true`). Off for V1: they
   * come back with heavier moderation. The data and code stay, so turning
   * it on brings back everything already posted.
   */
  commentsEnabled: boolean;
  /** Screenshot storage. Without it, screenshots go to Convex file storage. */
  b2: B2Config | null;
  /**
   * The VAPID public key browsers subscribe with (base64url). Its private
   * half lives on Convex, which sends the notifications. Without it, the
   * browser notifications setting is hidden.
   */
  vapidPublicKey: string | null;
}

type Env = Record<string, string | undefined>;

function credentials(env: Env, prefix: string): OAuthClientCredentials | null {
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

const B2_VARIABLES = ["B2_ENDPOINT", "B2_REGION", "B2_BUCKET", "B2_KEY_ID", "B2_APPLICATION_KEY"] as const;

/**
 * All five B2 variables, or none. A partial set is a deployment mistake, so
 * it stops the server rather than quietly filling Convex storage instead.
 */
function b2Storage(env: Env): B2Config | null {
  const [endpoint, region, bucket, keyId, applicationKey] = B2_VARIABLES.map((name) => env[name]?.trim() ?? "");
  const missing = B2_VARIABLES.filter((name) => !env[name]?.trim());
  if (missing.length === B2_VARIABLES.length) return null;
  if (missing.length > 0) {
    throw new Error(
      `B2 storage is half configured. Set ${missing.join(", ")} too, or none of them for Convex storage.`,
    );
  }
  if (!URL.canParse(endpoint)) throw new Error(`B2_ENDPOINT isn't a URL: ${endpoint}`);
  return { endpoint: endpoint.replace(/\/+$/, ""), region, bucket, keyId, applicationKey };
}

export function loadConfig(env: Env = process.env): Config {
  return {
    appUrl: new URL(env.APP_URL ?? "http://localhost:5173"),
    devLogin: import.meta.env.DEV && env.DEV_LOGIN !== "false",
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
    facebook: credentials(env, "FACEBOOK"),
    contentCheck: env.OPENROUTER_API_KEY?.trim()
      ? {
          apiKey: env.OPENROUTER_API_KEY.trim(),
          baseUrl: env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
          model: env.OPENROUTER_MODEL?.trim() || "deepseek/deepseek-v4.1-flash",
          provider: env.OPENROUTER_PROVIDER?.trim() || "deepseek",
        }
      : null,
    commentsEnabled: env.COMMENTS_ENABLED?.trim() === "true",
    b2: b2Storage(env),
    vapidPublicKey: env.VAPID_PUBLIC_KEY?.trim() || null,
  };
}

export const config: Config = loadConfig();

/** Absolute URL for a path on this site. */
export function absoluteUrl(path: string): string {
  return new URL(path, config.appUrl).href;
}
