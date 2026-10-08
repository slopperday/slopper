/**
 * Checks what a browser sends when it turns notifications on. Convex posts
 * to the endpoint for every notification, so only the browsers' own push
 * services are accepted: anything else would let a person point Slopper's
 * requests at any URL they like.
 */

const PUSH_SERVICES = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Samsung Internet, Opera, Brave
  "push.services.mozilla.com", // Firefox
  "push.apple.com", // Safari
  "notify.windows.com", // Edge on Windows
] as const;

const BASE64URL = /^[A-Za-z0-9_-]+=*$/;

export interface BrowserSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    PUSH_SERVICES.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  );
}

function isKey(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max && BASE64URL.test(value);
}

/** `PushSubscription.toJSON()` from the browser, or null when it isn't one. */
export function parseSubscription(body: unknown): BrowserSubscription | null {
  if (typeof body !== "object" || body === null) return null;
  const { endpoint, keys } = body as { endpoint?: unknown; keys?: unknown };
  if (!isPushEndpoint(endpoint) || typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  // A P-256 public key is 65 bytes (87 base64url characters); the auth secret is 16 (22).
  if (!isKey(p256dh, 80, 100) || !isKey(auth, 16, 32)) return null;
  return { endpoint, p256dh, auth };
}
