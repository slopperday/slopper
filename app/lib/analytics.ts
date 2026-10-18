/**
 * Paths with something private in them, rewritten in the browser before
 * analytics records them. Query strings are never recorded at all.
 */
export function sanitizeAnalyticsPath(path: string): string {
  return path.replace(/^\/unsubscribe\/[^/]+/, "/unsubscribe/:token");
}

/** Pages only you or the staff see: settings, keys, sign-in codes, notifications, moderation and analytics. */
const UNRECORDED = /^\/(settings|cli|notifications|mod|analytics)(\/|$)|\/analytics$/;

/**
 * Whether session replay may record a page. Private pages never are, and
 * neither are pages whose path holds a secret (the SDK skips those itself).
 */
export function mayRecordPath(path: string): boolean {
  return !UNRECORDED.test(path);
}
