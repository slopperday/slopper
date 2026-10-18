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
| `src/player/`    | Plays recordings back (rrweb's player): import it lazily, on admin pages only.                 |
| `src/react/`     | `AnalyticsProvider`, `useAnalytics`, `useIdentify`, `useFeatureFlag` and its siblings.         |
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

## Groups

Tag events with what they're about, `type:id` (PostHog calls this group analytics): a project, a team, a listing.
Browsers never set it; the app's server does, from the page's path (`RouteOptions.groupsForPaths`) or in a server capture
(`group`). Events are indexed by group, so one group's report reads only its own events.

## Insights

`analytics.insight(ctx, query)` answers, from an action, by reading events and sessions a page at a time:

| Kind         | What it answers                                                                         |
| ------------ | --------------------------------------------------------------------------------------- |
| `trends`     | Events, people or sessions per day, week or month, for up to four events or a breakdown |
| `funnel`     | People through ordered steps within a window, with drop-off and time between steps      |
| `retention`  | Cohorts by first start event, and who came back period by period                        |
| `paths`      | Journeys between pages, session by session (from a page, or leading to one)             |
| `stickiness` | How many days in the range people did something                                         |
| `lifecycle`  | New, returning, resurrecting and dormant people per period                              |
| `web`        | Visitors, sessions, page views, duration and bounce rate, with sources and devices      |
| `groups`     | Every group against the period before: climbing, fading, new                            |

`analytics.groupReport` is everything about one group: views, people, sources, clicks and the app's own events.
`analytics.overview` counts people. Queries are validated by `insightQueryValidator`; the aggregators are pure
(`src/shared/insights`) and read at most `SCAN_LIMIT` rows, saying `truncated` past it.

## Feature flags

A flag is on or off, or one of several weighted variants, for each person. Who gets it is a list of conditions
(property filters, a rollout percentage, optionally a fixed variant); the first one someone matches and is rolled into
decides. Buckets come from hashing the flag's key with the distinct id (`bucketOf`, cyrb53), so a person keeps their
value as a rollout grows, and the variant has its own bucket, so it doesn't move with the rollout.

Evaluating is pure (`evaluateFlags`, `flagState` in `src/shared/flags.ts`), so flags cost a page nothing in the
browser: the app's server reads the active definitions (`components.analytics.flags.definitions`, worth caching),
evaluates them while it renders, and hands the result to `AnalyticsProvider`'s `flags`. Code reads them with
`useFeatureFlag(key)` (false, true or the variant), `useFeatureFlagEnabled` and `useFeatureFlagPayload` (its JSON).
Once the SDK has loaded, each value someone sees is captured as `$featureFlagCalled` once a session.

To bucket people before the SDK has loaded, the server needs their distinct id on their first page: mint one (a
UUIDv7, `uuidv7`) into the `sa_id` cookie when there isn't one, and the SDK keeps it.

## Experiments

An experiment is a flag with variants and a goal event. `analytics.experiment(ctx, key)` reads who saw each variant
while it ran (their first `$featureFlagCalled`) and who did the goal after, then compares the variants the Bayesian
way: each conversion rate as a Beta distribution, sampled to give every variant's 95% interval and its chance of being
best. It calls a winner once every variant has `MINIMUM_EXPOSURE` people and one is 95% likely to be best. Sampling
is seeded by the experiment's key, so the same counts always read the same.

## Session replay

With `replay: { sampleRate }`, the SDK records that share of sessions with rrweb (picked by session id, so every page
of one agrees). The recorder is its own chunk, loaded only for recorded sessions, after the SDK. Every few seconds it
sends what it has to `ROUTES.recordings` as one gzipped chunk, and the component stores chunks as they came, in its
file storage (`recordings.get` hands out their URLs). Fields are masked; hidden inputs, `[data-no-capture]` and
`[data-no-replay]` are blocked out; `[data-sensitive]` text is masked; scripts are left out; query strings are cut
from every link, form and page address; and pages whose path `sanitizePath` rewrites, or that `replay.mayRecord`
rules out, pause the recording. Recordings go after 30 days (`retention.recordingDays`) and with `forget`.

`@slopperday/analytics/player` reads a recording back (`loadRecording`) and plays it (`createReplayer`).

## Privacy controls

`optOut()` sets a first-party cookie (`sa_off`) the SDK and the app's server both read, and deletes the distinct id;
`optIn()` starts over as a new visitor. `forget(distinctId)` deletes a person and everything they did.

## Tests

`vp test packages/analytics` runs the shared logic, the component (convex-test) and the SDK (happy-dom).
