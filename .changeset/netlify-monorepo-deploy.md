---
slopper:
  type: fix
---

# Release deploys reach Netlify from the monorepo root

netlify-cli saw packages/cli and packages/skill as workspace projects, asked which one to deploy and failed in the release workflow after Convex was deployed. `release.ts deploy` now starts it in scripts/ and points --cwd at the app, which skips the question. A manual run of the release workflow can also publish only the npm packages, for a release whose site is already live.
