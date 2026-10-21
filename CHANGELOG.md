# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.11.0 (2026-10-21)

### Features

#### Race tallies and anti-gaming rules for slop of the day

_Owner:_ Ifiok Jr. · _Introduced in:_ 40168d4

- Slops keep raceUpvotes/raceDownvotes beside their totals: only votes cast on raceDate move them, so the tally stops when the day ends and the crown at 00:01 UTC ranks on it (convex/race.ts raceTally). Older slops fall back to their totals.
- Votes record inRace. countsInRace leaves out votes from accounts younger than LIMITS.raceVoterAge (a day), downvotes from makers with a slop in the same race, and swapped upvotes between two racing makers (the earlier one comes out of its tally too).
- The rules page, /today, llms.txt and the agent skill say what counts.

#### Public operations and per-address rate limits

_Owner:_ Ifiok Jr. · _Introduced in:_ f0ed930

- Operations are `UserOperation` or `PublicOperation` (`app/.server/agent/operations.ts`); `runOperation` refuses a user operation without a user. REST serves public ones without a token; a bad token is still a 401 everywhere. MCP still needs a token.
- `apiQuota` (`app/.server/tokens.ts`) keys calls by user, or by `callerAddress` without one, with `LIMITS.apiCallsPerHour` and `LIMITS.anonymousApiCallsPerHour`; a 429 carries `Retry-After`.
- `users.profile` returns the owner's `today`.

### Fixes

#### Launch days are UTC days

_Owner:_ Ifiok Jr. · _Introduced in:_ 6372f1b

- `insertLaunch` dates a launch itself: `launchDate` is the UTC date it went out, the same as `raceDate`. `slops.create` no longer takes `today`, and goal, profile, streak, scheduling and edit-window code use `utcDate` (app/lib/dates.ts). `timeZone` is only for clock times, typed wall times and the digest.
- `raceStartOn` and `localDayStart` are gone: the next free day starts at its midnight UTC.
- `launchDays.toUtcDays` (internal) lists launches whose `launchDate` was their maker's local date and, with `apply`, moves them onto their `raceDate` with their goal day; `launchDays.moveLaunch` backdates one launch for the e2e tests.

- **Page speed counts visits that leave early.** A visit that left before the web-vitals chunk loaded or reported sent no `$webVitals`, so the quickest bounces were missing from /analytics/speed. It now sends the first paint and time to first byte the browser already has. The e2e speed test waits for the first paint instead of racing the chunk, and the scheduled-launch test polls for the content check's verdict instead of reading it once.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 7fe30fa

## 1.10.0 (2026-10-18)

### Features

#### First-party analytics as a Convex component

_Owner:_ Ifiok Jr. · _Introduced in:_ 195eec1

- **packages/analytics** (private, with nothing Slopper-specific so it can move out): a Convex component with events, people (anonymous until identify, merged into the account on sign-in, two accounts never merged) and sessions with source, channel, device and country; a browser SDK with page views and leaves, autocapture, rage clicks, opt-out and beaconed batches; React bindings; and shared pure logic.
- **Wiring.** Mounted in `convex/convex.config.ts`. Browsers post to the deployment's HTTP actions (`convex/http.ts`, `/a/e`), so no Netlify function runs per event. `CONVEX_SITE_URL` names the site URL for self-hosted backends; cloud deployments work it out from `CONVEX_URL`. The CSP allows it.
- **Product events** are captured in their mutations: signed up, slop launched, voted, pledged, update posted and goal set. A daily cron deletes events older than a year.
- **Tests** build the Convex app with `tests/convexApp.ts`, which registers the component.

#### Insights, a platform dashboard and analytics per slop

_Owner:_ Ifiok Jr. · _Introduced in:_ 7264d88

- **Insights engine** (`packages/analytics`): trends (with breakdowns), funnels, retention, journeys, stickiness, lifecycle, web analytics and a group leaderboard, as pure aggregators that an action feeds page by page (`SCAN_LIMIT` rows at most, `truncated` past it). Components can't `paginate()`, so the component pages by index key.
- **Group analytics**: events carry `slop:<id>` when they're on a slop's page (resolved on the server from the path) or about it (votes, pledges, updates, comments). Downvotes are kept from makers.
- **/analytics** for admins only: growth (accounts, launches, makers), slops climbing and fading, traffic, insights and people (with forgetting someone, logged in the staff log). Charts use a validated palette in both themes.
- **Makers' analytics** at `/@username/slug/analytics`, the `slop_analytics` operation (MCP and `GET /api/v1/slops/:slop/analytics`) and `slopper analytics <slop>`.
- **Admins' agents**: `slopper admin analytics [report]` over `GET /api/v1/admin/analytics`, deliberately undocumented outside AGENTS.md.

#### Analytics dashboards read daily rollups

_Owner:_ Ifiok Jr. · _Introduced in:_ 49b9c42

- A daily cron (04:00 UTC) rolls each finished day of first-party analytics into rollup rows: web analytics, each event's count and people, and each slop's page views. Web analytics, trends without filters or breakdown, and the projects leaderboard read whole past days from them and raw events only for today and the partial day at the start, with the same answers. On a seeded month of 2,000 visits, the 30-day traffic page read 13.9 MB of events before and 0.9 MB after.
- A day is read raw again as soon as anything changes it (a late batch, a session past midnight, a merge, a forgotten person), until the next roll-up does it again.
- Events lose their timestamp-only index: reading every event and the retention sweep go name by name instead. After deploying, backfill once with `convex run analytics:rollUp '{"lookbackDays": 365}'`.

- **API answers say what people see instead of the check's verdict.** The REST API and MCP tools no longer return `contentCheck`. Uploads (`POST /api/v1/media`, `upload_screenshot`, and the site's `/api/media`) return `nsfw: true` when the image will blur a slop, and every slop summary has `hidden` (only its maker can see it) next to `nsfw`. Auto-post hold reasons (`autopostHold`, `holdReason`) no longer mention the content check.
  _Owner:_ Ifiok Jr. · _Introduced in:_ d2fda0c

#### Reviews, checked before they're saved

_Owner:_ Ifiok Jr. · _Introduced in:_ cc9184e

- **Reviews** (convex/reviews.ts): one per person per launch, replaced when written again; not for the maker's own slop or a hidden one. Screenshots must be the reviewer's own uploads, and a mature one makes the review mature (blurred for people who haven't opted in to NSFW).
- **postReview** (app/.server/reviews.ts) runs the content check on the text and screenshots first: blocked is refused and never saved, ok and mature go up at once, and when the check can't run the review is saved as unchecked, like uploads. No moderator queue.
- Authors and admins (new reviews.deleteAny permission, logged as deleteReview) can delete a review; makers can't. releaseMedia and slop deletion know about review screenshots.
- New notification kind review, counted in the daily digest. Analytics event reviewed, shown to makers.
- Agents: review_slop and list_reviews operations, PUT /api/v1/slops/:slop/reviews/mine and GET /api/v1/slops/:slop/reviews.

#### Charts on ECharts, with comparisons

_Owner:_ Ifiok Jr. · _Introduced in:_ cacbc98

- The analytics charts are ECharts now, loaded in their own chunk once a chart is on screen (about 167 KB brotli, never on public pages): lines with a crosshair tooltip and a legend that turns lines on and off, stacked columns, funnels that show who dropped off, and journeys as a Sankey diagram you can trace by hovering. Long ranges zoom with ctrl and the wheel, or a pinch. Every chart keeps its table.
- Comparisons with the period before: trends take `compare` ("Compare with the period before" on /analytics/insights), and traffic and a slop's views draw the days before as a dashed line, with the change in the tooltip. Web and slop reports carry `previousSeries`.
- Charts animate unless motion is turned down, in Settings or on the device.

#### Error tracking

_Owner:_ Ifiok Jr. · _Introduced in:_ ef45366

- The analytics SDK records uncaught errors and unhandled rejections as `$exception` events (type, message, a short stack without query strings, a fingerprint that groups the same error across deploys), at most 25 a page and the same one once a minute; extension noise is left out. `captureException` records caught ones, and the root error boundary uses it.
- The app server reports errors in loaders, actions and rendering (`handleError`) through `analytics.captureServerError`, tied to the visitor's analytics id unless they turned analytics off. Server events can now say which page they happened on.
- Admins see issues at /analytics/errors: how often, for how many people, where, the stack, and the sessions they happened in, with their recordings. Agents get them with `slopper admin analytics errors` and `error --q <fingerprint>`.

#### Feature flags and experiments

_Owner:_ Ifiok Jr. · _Introduced in:_ 633e877

- **Flags** (`packages/analytics`): on or off, or weighted variants, for people matching conditions and a rollout. Buckets hash the flag's key with the distinct id, so people keep their value as a rollout grows. Evaluating is pure; the app server evaluates active flags while it renders (definitions kept in memory: fresh for 30s, used for up to 5 minutes while they're read again), and `useFeatureFlag`, `useFeatureFlagEnabled` and `useFeatureFlagPayload` read them on the first render. The SDK records each value someone sees once a session (`$featureFlagCalled`).
- **First-page ids**: the root middleware sets the `sa_id` cookie on a visitor's first page (unless they opted out), so flags can bucket them before the SDK loads; the SDK keeps it.
- **Experiments**: a flag with variants and a goal event, compared the Bayesian way (each variant's rate, 95% interval and chance of being best; a winner once each has 100 people and one is 95% likely best), seeded so results are stable.
- **/analytics/flags** and **/analytics/experiments** for admins, with each flag's recent views by variant, and every change in the staff log. Admins' agents read them with `slopper admin analytics flags|experiments|experiment`.

#### Heatmaps

_Owner:_ Ifiok Jr. · _Introduced in:_ 8a67573

- The analytics SDK sends where every click lands as `$heatmap` events (up to 50 points per page and viewport width), and page leaves carry the viewport width. Clicks inside `data-no-capture` aren't kept, and the SDK doesn't run inside frames.
- A `heatmap` insight places clicks for phones, tablets or desktops, and counts views, scroll depth and the most-clicked links and buttons.
- Admins see it at /analytics/heatmaps: the page as it is now, in a same-origin frame (the CSP now allows Slopper to frame its own pages), with its clicks over it. Agents get it with `slopper admin analytics heatmap`.

#### Made-with tags are counted and spelled one way

_Owner:_ Ifiok Jr. · _Introduced in:_ ac8f81b

- **Tags** (`app/lib/tags.ts`): a registry of kinds (model, harness, framework, platform, other) and known tags with aliases. `cleanTags` spells known ones our way and drops repeats in any case.
- **Counts** live in `madeWithTags`, kept by `retag` (`convex/lib/tags.ts`) when a slop launches, is edited or deleted, so "claude code" and "Claude Code" are one tag. `tags.popular` feeds the picker; people's own tags are suggested once two slops use them.
- **Backfill.** `tags:backfill` runs after every Convex deploy (`scripts/release.ts`): it counts and respells existing slops' tags once, then does nothing.
- **Agents:** `list_tags` (MCP) and `GET /api/v1/tags`. Slops can have up to 8 tags (was 6).

#### Session replay

_Owner:_ Ifiok Jr. · _Introduced in:_ a396e65

- The analytics SDK records a share of sessions (`ANALYTICS_REPLAY_RATE`, every one unless set) with rrweb, loaded only for those sessions after the SDK itself, and sends gzipped chunks every few seconds to `/a/r` on the Convex site. The analytics component keeps them in its file storage for 30 days, and `forget` deletes them with everything else.
- What's private stays in the browser: fields are masked, hidden inputs and `data-no-capture`/`data-no-replay` parts are blocked out, scripts are left out, query strings are cut from every address, and private pages (settings, the CLI sign-in, notifications, staff pages and a slop's own analytics) aren't recorded. The owner's money ledger is blocked out.
- Admins watch recordings at /analytics/recordings and on each session's page, with page views and clicks marked on the timeline, speeds up to 8× and quiet bits skipped. A person's sessions say which were recorded, and `slopper admin analytics recordings` lists them for agents.

#### Staff permissions in one table, and a staff log

_Owner:_ Ifiok Jr. · _Introduced in:_ a1fed56

- **Permissions, not roles.** `convex/lib/permissions.ts` maps each role to what it may do (`queue.decide`, `slops.hide`, `team.manage`, ...). Convex checks `requirePermission`, routes `requireStaff(viewer, request, permission)`, and loaders send `permissionsOf(user)` instead of the role, so a new role or a moved power is one change in that table. `canModerate`, `isAdmin` and `requireRole` are gone.
- **Staff log.** Every use of a staff power (role changes, queue decisions, takedowns, trust, hiding, and deleting someone else's slop or comment) is written to `staffActions` in the same mutation. Admins see the latest 50 at /mod/team. It never reaches a public shape.

#### Surveys

_Owner:_ Ifiok Jr. · _Introduced in:_ 4f94381

- Admins ask one question on the pages they pick, at /analytics/surveys: a rating, 0 to 10, one of a few options, or words, with an optional follow-up, for anyone, signed-in people or visitors, after a delay. Starting, stopping and changes go in the staff log.
- Pages get running surveys from the root loader (kept in memory, so they cost a page nothing) unless analytics is off. A small card asks the first one this browser hasn't answered or closed, once. Answers are analytics events, so a survey's results (who saw it, answered and closed it, the answers charted, the average or Net Promoter Score, and what people wrote, linked to their visits) come from a `survey` insight. Agents read them with `slopper admin analytics surveys` and `survey --q <key>`.
- Flags and surveys share one in-memory cache on the app server (`remembered`).

- **Traction integrations and product page fields for agents and operators.** New integrations and metrics tables, read-only clients for Stripe, PostHog, Google Analytics (service account, GOOGLE_ANALYTICS_SERVICE_ACCOUNT) and Solana (SOLANA_RPC_URL), syncs claimed through Convex and run by the app server. create_slop and update_slop take video, features and audience; get_traction (GET /api/v1/slops/{slop}/traction) reads the board.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 85cae12

#### Web vitals

_Owner:_ Ifiok Jr. · _Introduced in:_ 67f3fad

- The analytics SDK measures the landing page's Core Web Vitals (LCP, INP, CLS, FCP, TTFB) with `web-vitals`, in its own chunk loaded after the SDK, and sends them as `$webVitals` when the page is hidden.
- A `vitals` insight gives each one's 75th percentile with web.dev's rating and the shares of good, middling and poor loads, overall and per page. Admins see it at /analytics/speed; agents with `slopper admin analytics vitals`.

### Fixes

#### Admins are listed by sign-in account, and moderators don't judge their own slops

_Owner:_ Ifiok Jr. · _Introduced in:_ a1fed56

- **`ADMIN_IDENTITIES` replaces `ADMIN_USERNAMES`.** It lists sign-in accounts as `provider:id` (`github:1160934`), and whoever signs in or links one becomes an admin (`grantListedAdmin`, `team.bootstrap`). Usernames can be changed in Settings and are picked from provider handles at sign-up, so a listed username that someone renamed away from, or never claimed, made whoever took it an admin on their next page load. A malformed entry stops the server. Set it with `vp run env:netlify`; `ADMIN_USERNAMES` is ignored and can be unset on Netlify. Stored roles are unchanged, so nobody loses theirs.
- **Moderators can't decide on their own slops.** `videos.decide` and `moderation.decide` refuse a moderator's own video or flagged slop (`mayJudge`): approving their own video would have trusted them, and clearing their own flags would have restarted its auto-posts. Admins still can. /mod shows a moderator's own items without decision buttons.

#### Analytics costs a page's first load nothing

_Owner:_ Ifiok Jr. · _Introduced in:_ 1145846

- The analytics SDK isn't in any script a page loads to render: the React provider imports it after the load event, when the browser is idle, and the landing page view is stamped with when the page was opened. A failed import leaves the page uncounted and nothing else broken.
- A burst of activity writes the session to localStorage once, not once per event.
- e2e: the browser launches with a real user agent. Requests a page finishes after it's gone (analytics' leave beacons) carry the browser's own, which says HeadlessChrome and was dropped as a bot's; `e2e/performance.spec.ts` checks the SDK stays out of the first load, arrives and sends after it, and that a page left at once still sends what it saw.

- **Only retry auto-posts on the signed-in person's own updates, and send Strict-Transport-Security on production pages.**
  _Owner:_ Ifiok Jr. · _Introduced in:_ afa01df
- **`vp run env:netlify` works again.** netlify-cli saw the workspace packages (`packages/*`) from the repo root, stopped to ask which project to use, and failed on the first variable. The sync now starts netlify-cli in `scripts/` and points `--cwd` at the app, as `scripts/release.ts` does for deploys.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 54484b3
- **Only connect Bluesky accounts whose PDS is a public web address, so a connected account can't aim the server's auto-post requests at private networks.**
  _Owner:_ Ifiok Jr. · _Introduced in:_ afa01df

### Refactoring

- **Drop the old admin flags from Convex.** `slops.page`, `slops.remove` and `activity.deleteComment` no longer accept the `isAdmin`/`asAdmin` arguments they ignored while v1.6.0 deployed. They read the caller's stored role (`canModerate`/`isAdmin` in `convex/lib/auth.ts`), and no app server since v1.6.0 sends them.
  _Owner:_ Ifiok Jr. · _Introduced in:_ d70dd30

## 1.9.0 (2026-10-18)

### Features

- **Update metadata for agents.** `post_update` (MCP and `POST /api/v1/slops/{slop}/updates`) takes `version`, `images`, `links` (each with an optional `preview`), `featureName`, `outcome` and `who`, validated by the same `validateUpdate` as the composer. Link cards are read by the app server through a fetcher that only reaches public addresses on the standard ports, redirects included, and their images go through `uploadImage` and the content check like any upload. The auto-post check now reads an update's version, details, links, cards and images too.
  _Owner:_ Ifiok Jr. · _Introduced in:_ bd47777

### Fixes

- **Keep internals out of user-facing messages.** Raw details now go to the logs instead of the page: a social network's refusal (status and body, `expectOk` in `app/.server/social/adapters.ts`), unexpected posting errors (`describeError`), sign-in callback errors, and why the video check couldn't run (its recorded reason is now "Couldn't check this video."). /mod no longer shows the checker's model and provider; `videoChecks` still records them.
  _Owner:_ Ifiok Jr. · _Introduced in:_ e4ec917

## 1.8.0 (2026-10-18)

### Changed

- **No package-specific changes were recorded; `slopper` was updated to 1.8.0.**

## 1.7.0 (2026-10-18)

### Features

- **Hybrid search over slops: Convex full-text plus OpenRouter embeddings.** `search.find` (Convex action) ranks name, tagline and description matches from three search indexes and the nearest slops from a vector index on `slopEmbeddings`, fused by weighted reciprocal rank. Embeddings (`openai/text-embedding-3-small` through OpenRouter) are made by a Convex action when a slop launches or its text changes. To turn search by meaning on, set `OPENROUTER_API_KEY` on Convex and run `npx convex run --prod search:backfill` once; without the key, search matches words only. `slops.recent` and `slops.hot` take several categories, each read from its own index range, and `recent` pages by creation time (`before`).
  _Owner:_ Ifiok Jr. · _Introduced in:_ c97810a

## 1.6.0 (2026-10-18)

### Features

#### Moderator and admin roles, and an automatic video check

_Owner:_ Ifiok Jr. · _Introduced in:_ 0e764fc

- **Roles live in Convex** (`users.role`, `convex/team.ts`): moderators only approve or reject what's queued at /mod (videos and flagged slops); admins also manage the team at /mod/team, revoke or restore video trust, take down videos the check let through, hide or unhide slops from their page, and delete anyone's slops and comments. Every moderation write names its moderator or admin, and Convex checks their stored role (`requireRole`). `slops.page`, `slops.remove` and `activity.deleteComment` read the caller's role instead of trusting an `isAdmin`/`asAdmin` argument, which also stops a browser from asking `slops.page` for hidden slops.
- **ADMIN_USERNAMES bootstraps admins**: the app server stores the role the first time it sees a listed person (`team.bootstrap`), and won't let anyone demote them while they're listed. Convex never lets the last admin go.
- **Trusted makers** (`videoTrust`): a moderator's first approval of someone's video trusts them; a revoke sticks until an admin restores it. A trusted maker's new video goes past `checkVideo` (`app/.server/moderation.ts`) as it's set: the same policy prompt, with the video sent inline as `video_url` to `OPENROUTER_VIDEO_MODEL` (default `google/gemini-3.1-flash-lite` on `OPENROUTER_VIDEO_PROVIDER`, default `google-ai-studio`) through the existing `OPENROUTER_API_KEY`. A pass plays at once; anything else stays in `videoReviews`. Every automatic decision is recorded in `videoChecks` (verdict, reason, model, provider, time) and shown to admins at /mod.
- **Moderators decide on the video they watched**: `videos.decide` takes the media id, so a replacement uploaded meanwhile waits for its own review.
- **Deploys stay smooth**: `slops.page` still accepts `isAdmin`, and `slops.remove` and `activity.deleteComment` still accept `asAdmin`, but ignore them, so the app server from the last release keeps serving slop pages while Convex deploys ahead of Netlify. They can go in the next release.

## 1.5.0 (2026-10-17)

### Changed

- **No package-specific changes were recorded; `slopper` was updated to 1.5.0.**

## 1.4.0 (2026-10-17)

### Changed

- **No package-specific changes were recorded; `slopper` was updated to 1.4.0.**

## 1.3.0 (2026-10-17)

### Changed

- **No package-specific changes were recorded; `slopper` was updated to 1.3.0.**

## 1.2.1 (2026-10-17)

### Fixes

- **Release deploys reach Netlify from the monorepo root.** netlify-cli saw packages/cli and packages/skill as workspace projects, asked which one to deploy and failed in the release workflow after Convex was deployed. `release.ts deploy` now starts it in scripts/ and points --cwd at the app, which skips the question. A manual run of the release workflow can also publish only the npm packages, for a release whose site is already live.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 74f3e8a
- **A new release pull request can replace a merged one.** GitHub deletes chore/release when a release pull request merges, so the next `run release` pushed with a stale origin/chore/release and `--force-with-lease` refused it. `release.ts pr` now fetches with --prune before pushing.
  _Owner:_ Ifiok Jr. · _Introduced in:_ dc67e1d
- **The release workflow pushes tags without the local git hooks, and can retry an older release.** `vp install` in the workflow installs the repo's git hooks, so pushing the release tags ran the pre-push CI on the runner, which can't start its Convex backend, and the v1.2.0 publish stopped before tagging. The publish step now runs without hooks (CI ran before the release commit was pushed). A manual run takes a release commit to check out, so a failed publish can be retried once newer commits are on main, and `release.ts ci` refuses to publish anything that isn't a release commit on main.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 7f21cb8

## 1.2.0 (2026-10-17)

### Features

- **Agents vote; mark_slopcessful is gone from MCP and REST.** The MCP server and REST API gain `vote` (`POST /api/v1/slops/:slop/vote`), and `whoami` and `todays_race` report the votes left today. `mark_slopcessful` and `POST /api/v1/slops/:slop/slopcessful` are removed: the daily crown marks the winner slopcessful. Votes record the UTC day they were cast (`castOn`) for the five-a-day allowance. Releases now use monochange 0.18.0.
  _Owner:_ Ifiok Jr. · _Introduced in:_ ae3f691
- **Host on Netlify instead of Deno Deploy.** Deno Deploy is being shut down, so slopper.day moves to Netlify. The React Router server builds into one Netlify Function and static files go to Netlify's CDN; `scripts/release.ts deploy` deploys Convex and then Netlify from this machine, and `publish` ends with it. Production variables are declared in `monosecret.toml` and `vp run env:netlify` sets them on Netlify, secrets read from one 1Password item. Deno is gone: `vp run start` and the e2e stack serve the build with Node (`scripts/serve.ts`). Screenshots are capped at 4 MB to fit Netlify's request limit.
  _Owner:_ Ifiok Jr. · _Introduced in:_ d6b9f03 · _Last updated in:_ ae3f691
- **Releases are pull requests, published from GitHub Actions.** `vp exec monochange run release` commits the release on `chore/release`, pushes it through the pre-push CI and opens its pull request. Merging it runs `.github/workflows/release.yml`, which tags the release, deploys Convex and Netlify when the site is in it, and publishes released npm packages with npm trusted publishing. Every other push to main skips the workflow, and `monochange run publish` refuses to run outside it.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 46faf07
- **Scheduled launches for agents.** `create_slop` (and `POST /api/v1/slops`) takes `releaseAt`: "next" or an ISO 8601 date-time. New operations `list_scheduled`, `release_scheduled` and `cancel_scheduled` are on MCP and REST (`GET /api/v1/scheduled`, `POST /api/v1/scheduled/:id/release`, `DELETE /api/v1/scheduled/:id`). Queued launches live in the `scheduledLaunches` table; at `releaseAt` Convex puts each out through the same code as a launch made now, then calls `POST /api/scheduled/:id` so the app server runs the content check and the auto-post.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 2e31e85

### Fixes

- **Netlify environment sync sets every variable.** netlify-cli 27 exits 0 without setting anything when `env:set` gets `--scope`, so the first sync reported 21 variables and set none. `vp run env:netlify` drops the flag, checks Netlify has every variable afterwards, and refuses a `SLOPPER_JWT_PRIVATE_KEY` that doesn't decode before it sets anything.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 7ac42d0 · _Last updated in:_ ae3f691
- **Serve robots.txt and the default share image.** public/og.png, which every page without a screenshot names as its og:image, never existed, so shared links had no card. `node scripts/og-image.ts` now draws it from the site's fonts and colours. robots.txt keeps crawlers off /api/, /auth/ (each followed sign-in link starts a real OAuth flow) and /unsubscribe/; every rule ends in a slash so no profile URL is caught by a prefix.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 9fa8334
- **Self-host fonts with preloads and matched fallbacks.** Big Shoulders, Schibsted Grotesk and Atkinson Hyperlegible Mono come from `@fontsource-variable` packages and ship as hashed assets, instead of a render-blocking Google Fonts stylesheet that only then requested the files. The root route preloads the Latin faces of the two fonts every page opens with. `app.css` declares fallback faces built on Arial and Arial Narrow Bold with `size-adjust` and ascent/descent overrides (capitals, digits and the narrow 1 get their own), so a late swap measures at no layout shift on the homepage from 320px to 1440px. The content security policy no longer allows fonts.googleapis.com or fonts.gstatic.com.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 40a8a5f · _Last updated in:_ ae3f691

## 1.1.0 (2026-10-09)

### Features

- **Release with monochange.** Changesets in `.changeset/` record every change worth releasing. User types (`user_feat`, `user_fix`, `user_change`) become the release notes on `/changelog`, read from `app/changelog/<version>.json`; every other type lands in `CHANGELOG.md`. `vp exec monochange run release` bumps `package.json`, writes both and commits on `main`; `vp exec monochange run publish` tags the release, pushes `main` with the tag, and waits until Deno Deploy serves it on slopper.day.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 8a6d374
