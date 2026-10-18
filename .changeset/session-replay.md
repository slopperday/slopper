---
slopper:
  type: feat
---

# Session replay

- The analytics SDK records a share of sessions (`ANALYTICS_REPLAY_RATE`, every one unless set) with rrweb, loaded only for those sessions after the SDK itself, and sends gzipped chunks every few seconds to `/a/r` on the Convex site. The analytics component keeps them in its file storage for 30 days, and `forget` deletes them with everything else.
- What's private stays in the browser: fields are masked, hidden inputs and `data-no-capture`/`data-no-replay` parts are blocked out, scripts are left out, query strings are cut from every address, and private pages (settings, the CLI sign-in, notifications, staff pages and a slop's own analytics) aren't recorded. The owner's money ledger is blocked out.
- Admins watch recordings at /analytics/recordings and on each session's page, with page views and clicks marked on the timeline, speeds up to 8× and quiet bits skipped. A person's sessions say which were recorded, and `slopper admin analytics recordings` lists them for agents.
