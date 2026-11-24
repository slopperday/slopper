/**
 * Pictures at the size they're shown. Screenshots and profile pictures are
 * stored as they were uploaded (a screenshot can be a 1 MB PNG), so on
 * Netlify they go through its Image CDN, which resizes them, picks WebP or
 * AVIF for the browser and caches the result at the edge.
 *
 * Only hosts in `netlify.toml`'s `[images] remote_images` can be resized
 * there; anything else (Convex storage in development, a link preview's
 * image) is left as it is. `tests/images.test.ts` keeps the two lists in step.
 */

/** Hosts whose pictures the Image CDN may fetch, as `netlify.toml` allows them. */
export const RESIZABLE_IMAGES: readonly RegExp[] = [
  // Screenshots, profile pictures and update images in the B2 bucket.
  /^https:\/\/f[0-9]{3}\.backblazeb2\.com\/file\/slopper-media\//,
  // Profile pictures from sign-in providers, from before they were copied to the bucket.
  /^https:\/\/avatars\.githubusercontent\.com\//,
  /^https:\/\/lh3\.googleusercontent\.com\//,
  /^https:\/\/pbs\.twimg\.com\//,
];

const ENDPOINT = "/.netlify/images";

/** Whether the Image CDN can resize this picture. */
export function isResizable(url: string): boolean {
  return RESIZABLE_IMAGES.some((pattern) => pattern.test(url));
}

export interface Resize {
  /** Width in pixels. */
  w?: number;
  /** Height in pixels. */
  h?: number;
  /** "cover" crops to `w` × `h`; the default keeps the whole picture inside them. */
  fit?: "cover";
  /** Which part a "cover" crop keeps; the middle by default. */
  position?: "top";
}

/** The picture at this size, or the original when it can't be resized here. */
export function resized(url: string, size: Resize, cdn: boolean): string {
  if (!cdn || !isResizable(url)) return url;
  const params = new URLSearchParams({ url });
  if (size.w) params.set("w", String(Math.round(size.w)));
  if (size.h) params.set("h", String(Math.round(size.h)));
  if (size.fit) params.set("fit", size.fit);
  if (size.position) params.set("position", size.position);
  return `${ENDPOINT}?${params.toString()}`;
}

export interface ImageSource {
  src: string;
  srcSet?: string;
  sizes?: string;
}

/**
 * For a picture shown at a fixed size in CSS pixels: that size, and twice it
 * for sharp screens.
 */
export function fixedImage(url: string, size: Resize, cdn: boolean): ImageSource {
  const src = resized(url, size, cdn);
  if (src === url) return { src };
  const double = resized(url, { ...size, w: size.w && size.w * 2, h: size.h && size.h * 2 }, cdn);
  return { src, srcSet: `${src} 1x, ${double} 2x` };
}

/** Widths offered for pictures whose width follows the layout. */
const WIDTHS = [320, 480, 640, 960, 1280, 1920] as const;

/**
 * For a picture whose width follows the layout: a set of widths, and
 * `sizes` (as in the `sizes` attribute) for the browser to pick from them.
 */
export function fluidImage(url: string, sizes: string, cdn: boolean, max = 1920): ImageSource {
  if (!cdn || !isResizable(url)) return { src: url };
  const widths = WIDTHS.filter((w) => w <= max);
  return {
    src: resized(url, { w: widths.at(-1) ?? max }, cdn),
    srcSet: widths.map((w) => `${resized(url, { w }, cdn)} ${w}w`).join(", "),
    sizes,
  };
}
