---
cli:
  type: feat
---

# Schedule launches from the CLI

`slopper launch --at next` (or `--at 2026-10-15T09:00`) schedules a launch instead of putting it out now. `slopper scheduled` lists what's waiting, `slopper release <id>` puts one out now and `slopper unschedule <id>` drops it. The skill explains when to line launches up.
