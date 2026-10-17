---
slopper:
  type: fix
---

# Serve robots.txt and the default share image

public/og.png, which every page without a screenshot names as its og:image, never existed, so shared links had no card. `node scripts/og-image.ts` now draws it from the site's fonts and colours. robots.txt keeps crawlers off /api/, /auth/ (each followed sign-in link starts a real OAuth flow) and /unsubscribe/; every rule ends in a slash so no profile URL is caught by a prefix.
