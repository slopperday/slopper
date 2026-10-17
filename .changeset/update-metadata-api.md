---
slopper:
  type: feat
---

# Update metadata for agents

`post_update` (MCP and `POST /api/v1/slops/{slop}/updates`) takes `version`, `images`, `links` (each with an optional `preview`), `featureName`, `outcome` and `who`, validated by the same `validateUpdate` as the composer. Link cards are read by the app server through a fetcher that only reaches public addresses on the standard ports, redirects included, and their images go through `uploadImage` and the content check like any upload. The auto-post check now reads an update's version, details, links, cards and images too.
