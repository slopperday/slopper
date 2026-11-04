---
slopper:
  type: feat
---

# Shared destination resolution and readiness for the studio

- `app/lib/destinations.ts`: `destinationFor` (account, then network, then shared), `readiness` (block/warn/info issues), `xTwins`, X prices. Used by the composer, `saveStudioPost` and the agent operations; a `block` is refused on save.
- `socialPosts.variants` (media subset, link, first comment per network or account) and `socialPosts.times` (account id to time, setting `notBefore`); drafts may have no accounts; `socialSettings.lastAccountIds`.
- `social.resolveUncertain`, the `resolve_social_delivery` operation and `POST /api/v1/social/deliveries/:delivery/resolve`; `retry` skips uncertain deliveries.
- `wallTime` is DST-safe; the composer reads typed times in the profile time zone.
- Mastodon media uploads go through the pinned transport.
- Reddit OAuth (`REDDIT_CLIENT_*`) with refreshing tokens and subreddits per account; LinkedIn Pages behind `LINKEDIN_PAGES` (Community Management API scopes, `organizationAcls`).
- `app/lib/setupGuides.ts` and docs/social-setup.md: setup steps for every network.
