---
slopper:
  type: feat
---

# Add the studio's posting engine, network adapters and agent access

- `socialPosts` and `socialDeliveries` in Convex (`convex/social.ts`): one leased delivery per account, with
  staggering (`notBefore`), reposts that wait for an original, repeats, pause, idempotency keys, a duplicate guard,
  an activity log, and a backstop that marks lost sends uncertain instead of resending them.
- Supporting tables in `convex/studio.ts`: settings (queue slots, pause, calendar token, webhook), snippets, brand
  voices, tracked links, preview links and RSS feeds.
- Network adapters gain `reply`, `remove` and `comments`, alt text, covers, collaborators, LinkedIn documents and
  YouTube thumbnails. One table, `app/lib/networks.ts`, says what each network takes.
- New routes: `/studio/calendar`, `/studio/settings`, `/studio/analytics.csv`, `/review/:token`, `/go/:code`,
  `/api/studio/assist`, `/api/studio/calendar/:token`, `/api/social/feeds`.
- Agent operations `list_social_accounts`, `create_social_post`, `list_social_posts` and `get_social_post` (MCP and
  `/api/v1/social/*`), with CLI commands `social-accounts`, `social-post`, `social-posts` and `social-status`.
- OAuth connect scopes for comments, replies and deletion on Meta and Threads.
