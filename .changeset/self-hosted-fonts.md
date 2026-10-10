---
slopper: fix
---

# Self-host fonts with preloads and matched fallbacks

Big Shoulders, Schibsted Grotesk and Atkinson Hyperlegible Mono come from `@fontsource-variable` packages and ship as hashed assets, instead of a render-blocking Google Fonts stylesheet that only then requested the files. The root route preloads the Latin faces of the two fonts every page opens with. `app.css` declares fallback faces built on Arial and Arial Narrow Bold with `size-adjust` and ascent/descent overrides (capitals, digits and the narrow 1 get their own), so a late swap measures at no layout shift on the homepage from 320px to 1440px. The content security policy no longer allows fonts.googleapis.com or fonts.gstatic.com.
