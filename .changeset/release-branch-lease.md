---
slopper:
  type: fix
---

# A new release pull request can replace a merged one

GitHub deletes chore/release when a release pull request merges, so the next `run release` pushed with a stale origin/chore/release and `--force-with-lease` refused it. `release.ts pr` now fetches with --prune before pushing.
