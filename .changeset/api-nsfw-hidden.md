---
slopper:
  type: feat
---

# API answers say what people see instead of the check's verdict

The REST API and MCP tools no longer return `contentCheck`. Uploads (`POST /api/v1/media`, `upload_screenshot`, and the site's `/api/media`) return `nsfw: true` when the image will blur a slop, and every slop summary has `hidden` (only its maker can see it) next to `nsfw`. Auto-post hold reasons (`autopostHold`, `holdReason`) no longer mention the content check.
