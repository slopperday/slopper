---
slopper:
  type: feat
---

# Error tracking

- The analytics SDK records uncaught errors and unhandled rejections as `$exception` events (type, message, a short stack without query strings, a fingerprint that groups the same error across deploys), at most 25 a page and the same one once a minute; extension noise is left out. `captureException` records caught ones, and the root error boundary uses it.
- The app server reports errors in loaders, actions and rendering (`handleError`) through `analytics.captureServerError`, tied to the visitor's analytics id unless they turned analytics off. Server events can now say which page they happened on.
- Admins see issues at /analytics/errors: how often, for how many people, where, the stack, and the sessions they happened in, with their recordings. Agents get them with `slopper admin analytics errors` and `error --q <fingerprint>`.
