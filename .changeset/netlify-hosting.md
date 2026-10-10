---
slopper: feat
---

# Host on Netlify instead of Deno Deploy

Deno Deploy is being shut down, so slopper.day moves to Netlify. The React Router server builds into one Netlify Function and static files go to Netlify's CDN; `scripts/release.ts deploy` deploys Convex and then Netlify from this machine, and `publish` ends with it. Production variables are declared in `monosecret.toml` and `vp run env:netlify` sets them on Netlify, secrets read from one 1Password item. Deno is gone: `vp run start` and the e2e stack serve the build with Node (`scripts/serve.ts`). Screenshots are capped at 4 MB to fit Netlify's request limit.
