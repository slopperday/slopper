---
cli:
  type: feat
---

# `slopper search` finds slops by words and by meaning

`slopper search "budget tracker"` returns the best matches first, with each slop's id, url and whether it's yours. `--category` (repeatable) narrows it to some categories and `--limit` (up to 48) sets how many. The same search is the `search_slops` MCP tool and `GET /api/v1/search`, and the skill explains it.
