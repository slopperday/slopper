import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { parseEnv } from "node:util";
import { ROUTES } from "@slopperday/analytics/shared";

// The Vite dev server reads secrets and the Convex URL from `.env.local`
// (written by `convex dev` and scripts/convex-keys.ts). Variables already in
// the environment win, as with Node's `--env-file`. A production build never
// reads it: Netlify sets the environment, and so do `vp run start` and the e2e stack.
// Neither do unit tests (Vitest's "test" mode), so they pass the same on every machine.
if (import.meta.env.DEV && import.meta.env.MODE !== "test" && existsSync(".env.local")) {
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

/** A sign-in provider ("github", "x"…) and that provider's id for an account. */
export interface SignInIdentity {
  provider: string;
  providerId: string;
}

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
  /** Any OpenRouter model that reads images (video, for the video check) and supports JSON mode. */
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

/**
 * Slopper's Google service account, for reading Google Analytics. Makers add
 * its email as a Viewer on their property; no OAuth, no per-person keys.
 */
export interface GoogleServiceAccount {
  clientEmail: string;
  /** PKCS #8 PEM. */
  privateKey: string;
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
  /**
   * Where browsers send analytics (packages/analytics): the deployment's
   * HTTP actions and the prefix convex/http.ts mounts them at. Null turns
   * analytics off: no SDK is loaded.
   */
  analyticsEndpoint: string | null;
  /** The share of sessions recorded for replay, from 0 to 1 (ANALYTICS_REPLAY_RATE, 1 unless set). */
  analyticsReplayRate: number;
  /** Issuer and private key for the JWTs Convex trusts. */
  jwtIssuer: string;
  jwtPrivateKey: string | null;
  /**
   * Sign-in accounts that are always admins (ADMIN_IDENTITIES). Everyone else
   * on the moderation team has a role stored in Convex (convex/team.ts).
   */
  adminIdentities: readonly SignInIdentity[];
  github: OAuthClientCredentials | null;
  google: OAuthClientCredentials | null;
  x: OAuthClientCredentials | null;
  linkedin: OAuthClientCredentials | null;
  facebook: OAuthClientCredentials | null;
  /** Automated content check. Without it, nothing is ever auto-posted. */
  contentCheck: ContentCheckConfig | null;
  /**
   * The check on trusted uploaders' promo videos: the same key and policy,
   * with a model that watches video (Gemini 3.1 Flash Lite on Google AI
   * Studio by default). Without it, every video waits for a moderator.
   */
  videoCheck: ContentCheckConfig | null;
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
  /** Google Analytics integration. Without it, Google Analytics isn't offered. */
  googleAnalytics: GoogleServiceAccount | null;
  /** Solana JSON-RPC for reading wallet payments. The public endpoint works for small wallets. */
  solanaRpcUrl: string;
}

type Env = Record<string, string | undefined>;

function credentials(env: Env, prefix: string): OAuthClientCredentials | null {
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * ADMIN_IDENTITIES: comma-separated `provider:id` pairs, like `github:1160934`.
 * A provider's id for an account never changes and nobody else can take it,
 * unlike a username, which is why admins aren't listed by username. A
 * malformed entry stops the server: it's a deployment mistake that would
 * otherwise quietly leave someone without the role they were meant to have.
 */
function adminIdentities(env: Env): SignInIdentity[] {
  return (env.ADMIN_IDENTITIES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      const provider = entry.slice(0, separator).trim().toLowerCase();
      const providerId = entry.slice(separator + 1).trim();
      if (separator < 0 || !provider || !providerId) {
        throw new Error(`ADMIN_IDENTITIES entries are provider:id, like github:1160934. Got "${entry}".`);
      }
      return { provider, providerId };
    });
}

/** Whether `identity` is one of the listed sign-in accounts. */
export function isListed(identities: readonly SignInIdentity[], identity: SignInIdentity): boolean {
  return identities.some(
    (listed) => listed.provider === identity.provider && listed.providerId === identity.providerId,
  );
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

/**
 * The deployment's HTTP actions live on its `.convex.site` URL: given as
 * CONVEX_SITE_URL, or worked out from a cloud deployment's `.convex.cloud`
 * URL. A self-hosted backend's site URL can't be worked out, so it needs
 * the variable.
 */
function analyticsEndpoint(env: Env, convexUrl: string | null): string | null {
  const explicit = env.CONVEX_SITE_URL?.trim() || env.VITE_CONVEX_SITE_URL?.trim();
  let site: string | null = null;
  if (explicit) {
    if (!URL.canParse(explicit)) throw new Error(`CONVEX_SITE_URL isn't a URL: ${explicit}`);
    site = explicit;
  } else if (convexUrl && URL.canParse(convexUrl)) {
    const url = new URL(convexUrl);
    if (url.hostname.endsWith(".convex.cloud"))
      site = `${url.protocol}//${url.hostname.replace(/\.convex\.cloud$/, ".convex.site")}`;
  }
  return site ? `${site.replace(/\/+$/, "")}${ROUTES.prefix}` : null;
}

function replayRate(env: Env): number {
  const value = env.ANALYTICS_REPLAY_RATE?.trim();
  if (!value) return 1;
  const rate = Number(value);
  if (!(rate >= 0 && rate <= 1)) throw new Error(`ANALYTICS_REPLAY_RATE is a share from 0 to 1, not ${value}.`);
  return rate;
}

/**
 * The service account's JSON key, as downloaded from Google Cloud, raw or
 * base64. A key that's set but unreadable stops the server.
 */
function googleServiceAccount(env: Env): GoogleServiceAccount | null {
  const raw = env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  const json = raw.startsWith("{") ? raw : atob(raw);
  const parsed: unknown = JSON.parse(json);
  const { client_email: clientEmail, private_key: privateKey } = (parsed ?? {}) as Record<string, unknown>;
  if (typeof clientEmail !== "string" || typeof privateKey !== "string") {
    throw new Error("GOOGLE_ANALYTICS_SERVICE_ACCOUNT needs a service account key with client_email and private_key.");
  }
  return { clientEmail, privateKey };
}

export function loadConfig(env: Env = process.env): Config {
  const convexUrl = env.CONVEX_URL?.trim() || env.VITE_CONVEX_URL?.trim() || null;
  return {
    appUrl: new URL(env.APP_URL ?? "http://localhost:5173"),
    devLogin: import.meta.env.DEV && env.DEV_LOGIN !== "false",
    secretKey: env.SLOPPER_SECRET_KEY?.trim() || null,
    convexUrl,
    analyticsEndpoint: analyticsEndpoint(env, convexUrl),
    analyticsReplayRate: replayRate(env),
    jwtIssuer: env.SLOPPER_JWT_ISSUER?.trim() || "https://slopper.day",
    jwtPrivateKey: env.SLOPPER_JWT_PRIVATE_KEY?.trim() || null,
    adminIdentities: adminIdentities(env),
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
    // Vertex AI serves the model too, but ignores temperature, so JSON-mode routing skips it.
    videoCheck: env.OPENROUTER_API_KEY?.trim()
      ? {
          apiKey: env.OPENROUTER_API_KEY.trim(),
          baseUrl: env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
          model: env.OPENROUTER_VIDEO_MODEL?.trim() || "google/gemini-3.1-flash-lite",
          provider: env.OPENROUTER_VIDEO_PROVIDER?.trim() || "google-ai-studio",
        }
      : null,
    commentsEnabled: env.COMMENTS_ENABLED?.trim() === "true",
    b2: b2Storage(env),
    vapidPublicKey: env.VAPID_PUBLIC_KEY?.trim() || null,
    googleAnalytics: googleServiceAccount(env),
    solanaRpcUrl: env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com",
  };
}

export const config: Config = loadConfig();

/**
 * Networks people can connect for auto-posting here, in the order copy names
 * them. X and LinkedIn need this server's keys; Bluesky uses app passwords.
 */
export function autopostNetworks(): string[] {
  return [...(config.x ? ["X"] : []), ...(config.linkedin ? ["LinkedIn"] : []), "Bluesky"];
}

/** Absolute URL for a path on this site. */
export function absoluteUrl(path: string): string {
  return new URL(path, config.appUrl).href;
}
