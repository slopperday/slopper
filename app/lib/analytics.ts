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

/** One token source per signed-in viewer. Refresh before the app's one-hour tokens expire. */
export function analyticsTokenSource(): () => Promise<string | null> {
  let cached: { token: string; until: number } | null = null;
  let pending: Promise<string | null> | null = null;

  return async () => {
    if (cached && cached.until > Date.now()) return cached.token;
    pending ??= (async () => {
      const response = await fetch("/api/convex-token", { headers: { accept: "application/json" } });
      if (response.status === 401) return null;
      if (!response.ok) throw new Error(`Analytics authentication failed (${response.status}).`);
      const body: unknown = await response.json();
      if (typeof body !== "object" || body === null || !("token" in body) || typeof body.token !== "string") {
        throw new Error("Invalid analytics authentication response.");
      }
      cached = { token: body.token, until: Date.now() + 50 * 60_000 };
      return body.token;
    })().finally(() => {
      pending = null;
    });
    return await pending;
  };
}
