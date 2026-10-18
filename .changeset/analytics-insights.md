---
slopper:
  type: feat
---

# Insights, a platform dashboard and analytics per slop

- **Insights engine** (`packages/analytics`): trends (with breakdowns), funnels, retention, journeys, stickiness, lifecycle, web analytics and a group leaderboard, as pure aggregators that an action feeds page by page (`SCAN_LIMIT` rows at most, `truncated` past it). Components can't `paginate()`, so the component pages by index key.
- **Group analytics**: events carry `slop:<id>` when they're on a slop's page (resolved on the server from the path) or about it (votes, pledges, updates, comments). Downvotes are kept from makers.
- **/analytics** for admins only: growth (accounts, launches, makers), slops climbing and fading, traffic, insights and people (with forgetting someone, logged in the staff log). Charts use a validated palette in both themes.
- **Makers' analytics** at `/@username/slug/analytics`, the `slop_analytics` operation (MCP and `GET /api/v1/slops/:slop/analytics`) and `slopper analytics <slop>`.
- **Admins' agents**: `slopper admin analytics [report]` over `GET /api/v1/admin/analytics`, deliberately undocumented outside AGENTS.md.
