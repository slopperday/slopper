/**
 * Paths with something private in them, rewritten in the browser before
 * analytics records them. Query strings are never recorded at all.
 */
export function sanitizeAnalyticsPath(path: string): string {
  return path.replace(/^\/unsubscribe\/[^/]+/, "/unsubscribe/:token");
}

/** Owner and staff pages can show unpublished launches, accounts and integration details outside masked inputs. */
const UNRECORDED =
  /^\/(new|goal|settings|cli|notifications|mod|analytics)(\/|$)|^\/@[^/]+\/[^/]+\/edit(\/|$)|\/analytics\/?$/i;

/**
 * Whether session replay may record a page. Private pages never are, and
 * neither are pages whose path holds a secret (the SDK skips those itself).
 * Owner page containers also carry `data-no-replay`: navigation can change
 * the address before React removes the outgoing private page's contents.
 */
export function mayRecordPath(path: string): boolean {
  // Match the router's decoded paths, including encoded names and trailing slashes.
  try {
    return !UNRECORDED.test(decodeURIComponent(path));
  } catch {
    return false;
  }
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
