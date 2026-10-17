---
slopper:
  type: feat
---

# Releases are pull requests, published from GitHub Actions

`vp exec monochange run release` commits the release on `chore/release`, pushes it through the pre-push CI and opens its pull request. Merging it runs `.github/workflows/release.yml`, which tags the release, deploys Convex and Netlify when the site is in it, and publishes released npm packages with npm trusted publishing. Every other push to main skips the workflow, and `monochange run publish` refuses to run outside it.
