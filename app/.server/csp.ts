/**
 * The Content-Security-Policy the production build sends
 * (app/entry.server.tsx). Scripts carry a per-response nonce — React Router
 * streams its hydration data as inline scripts, and the nonce travels with
 * `<ServerRouter>` to them — so a nonce policy costs nothing and keeps any
 * injected inline script inert: without the nonce it renders as text. Styles
 * stay inline (`style-src 'unsafe-inline'`): cards set CSS variables inline,
 * and style attributes cannot execute script. `'wasm-unsafe-eval'` lets the
 * page compile WebAssembly (the canvist editor behind Markdown fields) and
 * nothing else: it never allows `eval` or `new Function`.
 */
export function contentSecurityPolicy(
  nonce: string,
  sources: { convex: readonly string[]; frames: readonly string[] },
): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    // Demo videos play in their host's player, loaded by a click; heatmaps draw Slopper's own pages.
    `frame-src 'self' ${sources.frames.join(" ")}`,
    `connect-src 'self'${sources.convex.map((source) => ` ${source}`).join("")}`,
    "object-src 'none'",
    "base-uri 'self'",
    // No workers today; said out loud so a future one that needs blob: is a
    // deliberate change, not a silent fallback to script-src.
    "worker-src 'self'",
    "form-action 'self'",
    // Only Slopper frames its own pages: the admins' heatmaps draw a page under its clicks.
    "frame-ancestors 'self'",
  ].join("; ");
}
