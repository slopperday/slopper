import { normalizeProperties, type Properties } from "../shared/properties";

/**
 * What the SDK remembers in the browser. The distinct id and the opt-out
 * live in first-party cookies, so the app's server can read them while it
 * renders a page (feature flags, and not rendering the SDK for people who
 * opted out). The session and super properties live in localStorage, shared
 * by every tab.
 */

export interface SessionState {
  id: string;
  startedAt: number;
  lastActivityAt: number;
}

export interface StoredState {
  session: SessionState | null;
  /** Sent with every event. */
  superProperties: Properties;
  /** The distinct id belongs to a signed-in account. */
  identified: boolean;
}

const YEAR_SECONDS = 365 * 86_400;

export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function writeCookie(name: string, value: string | null): void {
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie =
    value === null
      ? `${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; samesite=lax${secure}`
      : `${name}=${encodeURIComponent(value)}; path=/; max-age=${YEAR_SECONDS}; samesite=lax${secure}`;
}

const EMPTY: StoredState = { session: null, superProperties: {}, identified: false };

function parseSession(value: unknown): SessionState | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, startedAt, lastActivityAt } = value as Record<string, unknown>;
  if (typeof id !== "string" || typeof startedAt !== "number" || typeof lastActivityAt !== "number") return null;
  return { id, startedAt, lastActivityAt };
}

/**
 * localStorage when the browser allows it (some block it in private
 * windows), memory otherwise: the SDK still works, it just forgets on reload.
 */
export class StateStore {
  private memory: StoredState = EMPTY;

  constructor(private readonly key: string) {}

  private get storage(): Storage | null {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  read(): StoredState {
    const raw = this.storage?.getItem(this.key);
    if (raw === null || raw === undefined) return this.memory;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        session: parseSession(parsed.session),
        superProperties: normalizeProperties(parsed.superProperties),
        identified: parsed.identified === true,
      };
    } catch {
      return this.memory;
    }
  }

  write(state: StoredState): void {
    this.memory = state;
    try {
      this.storage?.setItem(this.key, JSON.stringify(state));
    } catch {
      // Full or blocked: memory keeps it for this page.
    }
  }

  clear(): void {
    this.memory = EMPTY;
    try {
      this.storage?.removeItem(this.key);
    } catch {
      // Blocked: nothing was stored.
    }
  }
}
