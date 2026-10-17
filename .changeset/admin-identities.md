---
slopper:
  type: fix
---

# Admins are listed by sign-in account, and moderators don't judge their own slops

- **`ADMIN_IDENTITIES` replaces `ADMIN_USERNAMES`.** It lists sign-in accounts as `provider:id` (`github:1160934`), and whoever signs in or links one becomes an admin (`grantListedAdmin`, `team.bootstrap`). Usernames can be changed in Settings and are picked from provider handles at sign-up, so a listed username that someone renamed away from, or never claimed, made whoever took it an admin on their next page load. A malformed entry stops the server. Set it with `vp run env:netlify`; `ADMIN_USERNAMES` is ignored and can be unset on Netlify. Stored roles are unchanged, so nobody loses theirs.
- **Moderators can't decide on their own slops.** `videos.decide` and `moderation.decide` refuse a moderator's own video or flagged slop (`mayJudge`): approving their own video would have trusted them, and clearing their own flags would have restarted its auto-posts. Admins still can. /mod shows a moderator's own items without decision buttons.
