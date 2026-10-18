---
slopper:
  type: feat
---

# First-party analytics as a Convex component

- **packages/analytics** (private, with nothing Slopper-specific so it can move out): a Convex component with events, people (anonymous until identify, merged into the account on sign-in, two accounts never merged) and sessions with source, channel, device and country; a browser SDK with page views and leaves, autocapture, rage clicks, opt-out and beaconed batches; React bindings; and shared pure logic.
- **Wiring.** Mounted in `convex/convex.config.ts`. Browsers post to the deployment's HTTP actions (`convex/http.ts`, `/a/e`), so no Netlify function runs per event. `CONVEX_SITE_URL` names the site URL for self-hosted backends; cloud deployments work it out from `CONVEX_URL`. The CSP allows it.
- **Product events** are captured in their mutations: signed up, slop launched, voted, pledged, update posted and goal set. A daily cron deletes events older than a year.
- **Tests** build the Convex app with `tests/convexApp.ts`, which registers the component.
