---
slopper:
  type: feat
---

# Resize pictures through Netlify's Image CDN

On Netlify (a Netlify global, or IMAGE_CDN=netlify), app/lib/images.ts sends B2 screenshots and sign-in providers' profile pictures through /.netlify/images at the size each component shows them, with 2x sources (or width sets for fluid ones) and AVIF/WebP picked by the browser. netlify.toml allows those hosts in [images] remote_images, and tests/images.test.ts keeps that list and RESIZABLE_IMAGES in step. Blurred NSFW covers fetch a 48px thumbnail. Elsewhere (dev, e2e) pictures are left as they are.
