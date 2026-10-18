---
slopper:
  type: feat
---

# Made-with tags are counted and spelled one way

- **Tags** (`app/lib/tags.ts`): a registry of kinds (model, harness, framework, platform, other) and known tags with aliases. `cleanTags` spells known ones our way and drops repeats in any case.
- **Counts** live in `madeWithTags`, kept by `retag` (`convex/lib/tags.ts`) when a slop launches, is edited or deleted, so "claude code" and "Claude Code" are one tag. `tags.popular` feeds the picker; people's own tags are suggested once two slops use them.
- **Backfill.** `tags:backfill` runs after every Convex deploy (`scripts/release.ts`): it counts and respells existing slops' tags once, then does nothing.
- **Agents:** `list_tags` (MCP) and `GET /api/v1/tags`. Slops can have up to 8 tags (was 6).
