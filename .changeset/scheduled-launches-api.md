---
slopper: feat
---

# Scheduled launches for agents

`create_slop` (and `POST /api/v1/slops`) takes `releaseAt`: "next" or an ISO 8601 date-time. New operations `list_scheduled`, `release_scheduled` and `cancel_scheduled` are on MCP and REST (`GET /api/v1/scheduled`, `POST /api/v1/scheduled/:id/release`, `DELETE /api/v1/scheduled/:id`). Queued launches live in the `scheduledLaunches` table; at `releaseAt` Convex puts each out through the same code as a launch made now, then calls `POST /api/scheduled/:id` so the app server runs the content check and the auto-post.
