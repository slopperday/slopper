# @slopperday/analytics

First-party product analytics on Convex. Events, people and sessions live in your own Convex deployment, in a
component with its own tables, and no third party ever sees them. Built for slopper.day, kept free of anything
Slopper-specific so it can move to its own repository.

## What's in it

| Path             | What it is                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `src/component/` | The Convex component: schema, ingestion, people, sessions, retention.                          |
| `src/convex/`    | For the app's own Convex functions: `Analytics` (HTTP routes, server-side capture, retention). |
| `src/browser/`   | The browser SDK: page views and leaves, autocapture, rage clicks, identify, opt-out, batching. |
| `src/react/`     | `AnalyticsProvider`, `useAnalytics`, `useIdentify`.                                            |
| `src/shared/`    | Pure logic both sides share: the wire format, property rules, user agents, traffic sources.    |

## Set up

Mount the component (`convex/convex.config.ts`):

```ts
import { defineApp } from "convex/server";
import analytics from "@slopperday/analytics/convex.config";

const app = defineApp();
app.use(analytics);
export default app;
```

Give it an HTTP endpoint and a daily sweep (`convex/http.ts`, `convex/crons.ts`):

```ts
import { Analytics } from "@slopperday/analytics/convex";
import { components } from "./_generated/api";

export const analytics = new Analytics(components.analytics);
analytics.registerRoutes(http, { allowedOrigins: ["https://example.com"] });
// In an internal mutation run daily:
await analytics.sweep(ctx, { eventDays: 365, personDays: 365 });
```

The browser sends to `<deployment>.convex.site/a/e` (`ROUTES`), so no app server runs per event. Allow that origin in
`connect-src` if the site has a Content Security Policy.

Render the provider once, near the root, and identify signed-in people:

```tsx
<AnalyticsProvider options={{ endpoint: "https://happy-otter-123.convex.site/a" }}>
  <App />
</AnalyticsProvider>;

useIdentify(user ? { distinctId: user.id, set: { username: user.username } } : null);
```

Capture what matters from server code, in the same transaction as the write it describes:

```ts
await analytics.capture(ctx, { name: "signed up", distinctId: userId, identified: true });
```

## What it records

- **Page views** on every history change, with the referrer and UTM tags of the landing page; **page leaves** with time
  on page and scroll depth.
- **Autocapture**: clicks on interactive elements (tag, short selector, visible text, link path, click position), form
  submissions and field changes. Field values never are; nor is anything inside `[data-no-capture]`, password fields or
  `[data-sensitive]`. Name an element for analysis with `data-capture="name"`.
- **Rage clicks**: three clicks within a second in one spot.
- **People**: anonymous until `identify`, which merges their earlier history into the account's. Two accounts are never
  merged.
- **Sessions**: events less than 30 minutes apart, at most a day long, with entry and exit pages, traffic source and
  channel, browser, OS, device type and (if the app passes it) country.

Query strings are never sent; `sanitizePath` rewrites paths with secrets in them. Bots are dropped at the endpoint. IP
addresses are never read.

## Privacy controls

`optOut()` sets a first-party cookie (`sa_off`) the SDK and the app's server both read, and deletes the distinct id;
`optIn()` starts over as a new visitor. `forget(distinctId)` deletes a person and everything they did.

## Tests

`vp test packages/analytics` runs the shared logic, the component (convex-test) and the SDK (happy-dom).
