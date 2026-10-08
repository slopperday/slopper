---
slopper: feat
---

# Release with monochange

Changesets in `.changeset/` record every change worth releasing. User types (`user_feat`, `user_fix`, `user_change`) become the release notes on `/changelog`, read from `app/changelog/<version>.json`; every other type lands in `CHANGELOG.md`. `vp exec monochange run release` bumps `package.json`, writes both and commits on `main`; `vp exec monochange run publish` tags the release, pushes `main` with the tag, and waits until Deno Deploy serves it on slopper.day.
