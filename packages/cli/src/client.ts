import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Where the CLI's settings come from, and the one HTTP client that talks to
 * slopper.day's REST API (`/api/v1`, documented at /llms.txt).
 */

export const DEFAULT_URL = "https://slopper.day";

/** Something the person (or agent) running the CLI can act on. Exit code 2 is a usage error. */
export class SlopperError extends Error {
  readonly details: Record<string, string> | null;
  readonly exitCode: 1 | 2;

  constructor(message: string, options: { details?: Record<string, string> | null; exitCode?: 1 | 2 } = {}) {
    super(message);
    this.name = "SlopperError";
    this.details = options.details ?? null;
    this.exitCode = options.exitCode ?? 1;
  }
}

export function usageError(message: string): SlopperError {
  return new SlopperError(message, { exitCode: 2 });
}

/** What `slopper login` saves. */
export interface SavedConfig {
  token?: string;
  url?: string;
}

export function configPath(env: Record<string, string | undefined>, home: string): string {
  if (env.SLOPPER_CONFIG_DIR) return join(env.SLOPPER_CONFIG_DIR, "config.json");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "slopper", "config.json");
}

export async function readConfig(path: string): Promise<SavedConfig> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SlopperError(`${path} isn't valid JSON. Fix it or run \`slopper logout\` to start over.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SlopperError(`${path} should hold a JSON object. Run \`slopper logout\` to start over.`);
  }
  const { token, url } = parsed as Record<string, unknown>;
  return {
    ...(typeof token === "string" ? { token } : {}),
    ...(typeof url === "string" ? { url } : {}),
  };
}

/** Saves the config readable by its owner only: it holds an API token. */
export async function writeConfig(path: string, config: SavedConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies to new files; an older config may have been wider.
  await chmod(path, 0o600);
}

export async function removeConfig(path: string): Promise<void> {
  await rm(path, { force: true });
}

/** The site's origin, from a flag, SLOPPER_URL or the saved config; slopper.day otherwise. */
export function resolveUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw usageError(`${value} isn't a URL. Pass the site's address, like ${DEFAULT_URL}.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw usageError(`${value} isn't an http(s) URL.`);
  return url.origin;
}

export interface Api {
  readonly url: string;
  get(path: string): Promise<unknown>;
  post(path: string, body: object): Promise<unknown>;
  patch(path: string, body: object): Promise<unknown>;
  delete(path: string): Promise<unknown>;
  /** Raw bytes, for screenshots. */
  upload(path: string, bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<unknown>;
}

interface ApiOptions {
  url: string;
  token: string | undefined;
  fetch: typeof fetch;
  userAgent: string;
}

function isErrorBody(value: unknown): value is { error: string; details?: Record<string, string> | null } {
  return typeof value === "object" && value !== null && typeof (value as { error?: unknown }).error === "string";
}

export function createApi({ url, token, fetch, userAgent }: ApiOptions): Api {
  async function request(
    method: string,
    path: string,
    body?: string | Uint8Array<ArrayBuffer>,
    contentType?: string,
  ): Promise<unknown> {
    if (!token) {
      throw new SlopperError(
        `No API token. Make one at ${url}/settings/api, then run \`slopper login --token <token>\` or set SLOPPER_TOKEN.`,
      );
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "user-agent": userAgent,
    };
    if (contentType) headers["content-type"] = contentType;
    let response: Response;
    try {
      response = await fetch(`${url}/api/v1${path}`, { method, headers, body });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new SlopperError(`Couldn't reach ${url}: ${reason}`);
    }
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: a proxy or an outage page. Report the status below.
    }
    if (response.ok) return parsed;
    if (isErrorBody(parsed)) throw new SlopperError(parsed.error, { details: parsed.details ?? null });
    throw new SlopperError(`${method} ${path} failed with HTTP ${response.status}.`);
  }

  return {
    url,
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, JSON.stringify(body), "application/json"),
    patch: (path, body) => request("PATCH", path, JSON.stringify(body), "application/json"),
    delete: (path) => request("DELETE", path),
    upload: (path, bytes, contentType) => request("POST", path, bytes, contentType),
  };
}
