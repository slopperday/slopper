---
cli:
  type: fix
---

# slopper help and the skill describe results, not Slopper's internals

`slopper screenshot` reports `nsfw: true` when an image will blur a slop, `launch --autopost` and `video` describe what happens without explaining the checks, and the skill reads `hidden` and `nsfw` on a launch.
