---
cli:
  type: fix
---

# The CLI ships with the skill built in and depends on nothing

`@slopperday/cli` no longer depends on `@slopperday/skill`. `vp pack` bundles SKILL.md into `dist/slopper.mjs`, so `slopper skill` prints and installs the same text with nothing else installed. npm publishes package.json as it is, so the old `workspace:^` dependency would have shipped literally and broken every `npx @slopperday/cli`.
