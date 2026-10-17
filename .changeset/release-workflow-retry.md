---
slopper:
  type: fix
---

# The release workflow pushes tags without the local git hooks, and can retry an older release

`vp install` in the workflow installs the repo's git hooks, so pushing the release tags ran the pre-push CI on the runner, which can't start its Convex backend, and the v1.2.0 publish stopped before tagging. The publish step now runs without hooks (CI ran before the release commit was pushed). A manual run takes a release commit to check out, so a failed publish can be retried once newer commits are on main, and `release.ts ci` refuses to publish anything that isn't a release commit on main.
