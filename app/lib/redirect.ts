/**
 * Netlify copies a request's query string onto any redirect whose target has
 * no query of its own (an empty `?` doesn't count), so after signing in
 * `/?code=…&state=…` stayed in the address bar. The server gives those
 * targets this parameter instead, and the page drops it once it loads.
 */
export const REDIRECT_MARKER = "_";

/** The URL without the marker, or null when it has none. */
export function withoutRedirectMarker(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(REDIRECT_MARKER)) return null;
  url.searchParams.delete(REDIRECT_MARKER);
  return url.pathname + url.search + url.hash;
}
