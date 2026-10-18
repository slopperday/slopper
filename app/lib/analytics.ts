/**
 * Paths with something private in them, rewritten in the browser before
 * analytics records them. Query strings are never recorded at all.
 */
export function sanitizeAnalyticsPath(path: string): string {
  return path.replace(/^\/unsubscribe\/[^/]+/, "/unsubscribe/:token");
}
