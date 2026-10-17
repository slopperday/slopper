import { mkdir, open, readFile, rm } from "node:fs/promises";
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

/** A file system call that failed, like a config nobody can read. Node, Bun and Deno all give them a code. */
export function isSystemError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    typeof (error as NodeJS.ErrnoException).code === "string" &&
    typeof (error as NodeJS.ErrnoException).syscall === "string"
  );
}

/** An environment variable, or undefined when it's unset or empty: `SLOPPER_TOKEN=` turns it off. */
export function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  return env[name] || undefined;
}

/** What `slopper login` saves: a token and the site it works on. */
export interface SavedConfig {
  token?: string;
  url?: string;
}

export function configPath(env: Record<string, string | undefined>, home: string): string {
  const dir = envValue(env, "SLOPPER_CONFIG_DIR");
  if (dir) return join(dir, "config.json");
  return join(envValue(env, "XDG_CONFIG_HOME") ?? join(home, ".config"), "slopper", "config.json");
}

export async function readConfig(path: string): Promise<SavedConfig> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (!isSystemError(error)) throw error;
    if (error.code === "ENOENT") return {};
    // Some reads fail without naming the file, like one that's a directory.
    throw new SlopperError(`Couldn't read ${path}: ${error.message}`);
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
  // `mode` only applies to new files and an older config may be wider, so
  // narrow it before the token goes in.
  const file = await open(path, "w", 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(`${JSON.stringify(config, null, 2)}\n`);
  } finally {
    await file.close();
  }
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

/** Why a request got no answer. Fetch wraps the cause (refused, DNS, TLS) in a bare "fetch failed". */
function networkReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}

/** The body as JSON, or undefined when it isn't any: an empty reply, or a proxy's or host's HTML page. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
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
    let text: string;
    try {
      response = await fetch(`${url}/api/v1${path}`, { method, headers, body });
      // The connection can also drop while the body arrives.
      text = await response.text();
    } catch (error) {
      throw new SlopperError(`Couldn't reach ${url}: ${networkReason(error)}`);
    }
    const parsed = parseJson(text);
    if (response.ok && parsed !== undefined) return parsed;
    if (isErrorBody(parsed)) throw new SlopperError(parsed.error, { details: parsed.details ?? null });
    // Every endpoint answers in JSON, so anything else isn't Slopper talking.
    if (response.ok) throw new SlopperError(`${url} answered ${method} ${path} without JSON. Is it a Slopper site?`);
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
