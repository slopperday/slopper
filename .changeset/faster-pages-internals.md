---
slopper:
  type: feat
---

# Lighter first load: Convex client after hydration, intent prefetch, fixed video box

LiveProvider imports convex/react in its effect, so the Convex client (59 KB, 14 KB brotli) leaves every page's first load; useLive already shows loader data until the subscription answers. The header's links, slop rows and maker links prefetch on intent (loaders have no side effects). The slop page's promo video gets aspect-video, which removes its layout shift (CLS 0.185 on desktop Lighthouse), and its poster is the cover resized to 1280px instead of the full upload.
