/**
 * Where things live, shared by the SDK, the Convex routes and the app
 * server that reads the SDK's cookies.
 */

/**
 * The routes on the deployment's `.convex.site` URL. Short and plain, since
 * blockers match on words like "analytics" and "track" in URLs.
 */
export const ROUTES = {
  /** What `Analytics.registerRoutes` mounts the endpoints under, unless told otherwise. */
  prefix: "/a",
  events: "/e",
  /** Session recordings (shared/replay.ts). */
  recordings: "/r",
} as const;

/** Names the SDK's cookies and storage keys unless the app picks another. */
export const DEFAULT_STORAGE_KEY = "sa";

/**
 * The SDK's first-party cookies: the distinct id, which an app's server
 * can read while rendering, and the opt-out, which it can honour before
 * any script runs.
 */
export function cookieNames(storageKey: string = DEFAULT_STORAGE_KEY) {
  return { distinctId: `${storageKey}_id`, optOut: `${storageKey}_off` } as const;
}

/** The localStorage key the SDK keeps its session and settings under, from its first event. */
export function stateKey(storageKey: string = DEFAULT_STORAGE_KEY): string {
  return `${storageKey}_state`;
}
