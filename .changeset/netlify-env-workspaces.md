---
slopper:
  type: fix
---

# `vp run env:netlify` works again

netlify-cli saw the workspace packages (`packages/*`) from the repo root, stopped to ask which project to use, and failed on the first variable. The sync now starts netlify-cli in `scripts/` and points `--cwd` at the app, as `scripts/release.ts` does for deploys.
