<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Slopper project notes

- **Run it:** `vp run convex` (local Convex, no account), `vp run keys` once, then `vp dev`. Validate with
  `vp run ci` (typegen, check, test, build, Playwright).
- **E2E:** `e2e/stack.ts` runs the production build against a throwaway Convex backend and a fake content check. Tests
  seed people and slops through Convex as the server (`e2e/fixtures.ts`) unless the journey is about that step. Assert
  only on data the test created: the database is shared by parallel workers.
  Each checkout gets its own block of e2e ports from its path (`e2e/ports.ts`), so worktrees can run CI at the same
  time; `E2E_PORT_BASE` moves one by hand.
- **CI defaults to local.** The pre-push hook runs `vp run ci`; hosted checks cost money and require explicit
  authorization. For the authorized security repairs, label the PR `security-ci` to run the same gates through
  `.github/workflows/ci.yml` (also available manually). A command-scoped pre-push bypass is authorized for those
  repairs; green current-head hosted checks and review remain required before merge. The separate
  `.github/workflows/release.yml` only publishes merged release pull requests and skips every other push.
- **Hosting:** Netlify runs the build (`netlify.toml`): static files from `build/client`, the server as one Netlify
  Function. Releases deploy from the release workflow (`node scripts/release.ts deploy --if-released`), Convex first;
  never connect Netlify to Git. A deploy by hand (`node scripts/release.ts deploy`) must run from the main checkout or
  a sibling worktree: in one nested inside the repo (`.claude/worktrees/`), Netlify resolves the outer checkout and
  uploads no function. Requests are capped at 6 MB (binary ones about 4.5 MB), so keep
  uploads under `LIMITS.mediaBytes`.
- **Production variables** are declared in `monosecret.toml`: plain values as defaults, secrets in the 1Password item.
  `vp run env:netlify` sets them on Netlify with one 1Password read. Add new variables there, not in the Netlify UI.
- **ESM only.** No CommonJS in source or output. The server renders with `react-dom/server.edge` so the production
  bundle has no `require` calls.
- **Data lives in Convex** (`convex/`). Privileged functions call `requireServer`; the app server signs ES256 JWTs with
  `sub: "server"` (`app/.server/convex.ts`). Browsers get user tokens from `/api/convex-token` for live queries.
- **Public shapes only.** Queries return `PublicSlop`/`PublicUser` (`convex/lib/shape.ts`); downvotes, auto-post wiring
  and sealed credentials never leave Convex.
- **Live pages** load data in the route loader, then subscribe with `useLive(query, args, loaderData)`.
- **Ids from forms or URLs** reach Convex as strings and are checked with `ctx.db.normalizeId`, never cast.
- **Agents:** every agent capability is an operation in `app/.server/agent/operations.ts`, served by both MCP (`/mcp`)
  and REST (`/api/v1`). Add new ones there, then give them a REST route, a command in the CLI
  (`packages/cli/src/commands.ts`, `@slopperday/cli`) and a line in its skill (`packages/skill/SKILL.md`).
- **CLI packages** (`packages/*`) are public on npm but not open source (`UNLICENSED`). They release together as the
  monochange group `cli` (tags `cli/v1.2.3`) and only the release workflow publishes them, with npm trusted publishing.
  That runs plain `npm publish`, which ships `workspace:` ranges as they are, so a published package never depends on
  another workspace package. A new package needs `vp exec monochange publish placeholder` once (with `npm login`), then
  `npm trust github <package> --file release.yml --repository ifiokjr/slopper`. Run monochange from the main checkout:
  in a worktree under `.claude/`, it discovers no packages.
- **Scheduled launches** wait in `scheduledLaunches` (`convex/schedule.ts`), never in `slops`, so no public query
  needs to hide them. At `releaseAt` Convex puts one out with `insertLaunch` (shared with `slops.create`) and calls
  `POST /api/scheduled/:id`; the app server leases it and runs `finishScheduled` (`app/.server/launch.ts`): the
  content check, then the auto-post. Failed checks retain the row for retry; expired leases recover crashed callers.
  Consume a successful completion before announcing, so a crash after posting cannot make a scheduled retry post again.
- **Days are UTC days**, the same for everyone (`app/lib/dates.ts`): a launch's `launchDate` (its goal day and the
  streak) is the UTC date it went out, equal to `raceDate`, and `insertLaunch` sets it, never the caller. Count days
  with `utcDate`; a person's `timeZone` is only for showing clock times, reading wall times they type and the 9am
  digest. Launches from before this hold their maker's local date: `launchDays.toUtcDays` lists and moves them.
- **Votes and slopcessful:** everyone gets `LIMITS.votesPerDay` (5) votes per UTC day (`convex/slops.ts` `vote`).
  A day's race ranks its launches on the votes cast that day (`raceUpvotes`/`raceDownvotes`, frozen when the day ends);
  every vote still adds to the slop's total. `countsInRace` (`convex/race.ts`) keeps out votes from accounts under a
  day old, downvotes from makers racing the same day, and upvotes two racing makers swap.
  Slopcessful is earned, never declared: `race.crown` marks the day's winner slopcessful, and verified milestones
  (1,000 users, $1,000 revenue; ROADMAP.md) will too. Keep its badge separate from slop of the day.
- **Screenshots** go through `uploadImage` (`app/.server/media.ts`): checked before they're stored (blocked ones never
  are), then written to B2 (`app/.server/storage.ts`) or, without the B2 variables, Convex storage. Image URLs are
  built in Convex from `MEDIA_PUBLIC_URL` (a Convex env var). Mutations that drop screenshots return `orphaned`; call
  `deleteOrphanedMedia` when it's above 0.
- **Promo videos** (`uploadVideo`, `convex/videos.ts`): one per slop. A new one waits in `videoReviews` until a
  moderator approves it at /mod, and has no public URL before that. Video media is never accepted as a screenshot
  (`ownedMedia`). A moderator's first approval trusts the maker (`videoTrust`); their later videos go past
  `checkVideo` (`app/.server/moderation.ts`) as they're set: same policy prompt, the video inline as `video_url` to
  `OPENROUTER_VIDEO_MODEL` (Gemini 3.1 Flash Lite on Google AI Studio by default). Only an `ok` plays at once; any other
  verdict, an error or no key leaves it queued. Every automatic decision goes in `videoChecks`, which stays server-side.
- **Moderation team:** roles are `users.role` in Convex (`convex/team.ts`); what each role may do is one table in
  `convex/lib/permissions.ts`. Check permissions, never role names: `can(user, "slops.hide")`, `requireStaff(viewer,
  request, permission)` on routes, and `requirePermission(ctx, actorId, permission)` in Convex with the acting
  `moderatorId`/`adminId`, so Convex checks the stored role; never trust a role flag from the caller. Loaders send
  `permissionsOf(user)`, not the role. Moderators only approve or reject what's queued at /mod (videos, flagged slops),
  never their own slops (`mayJudge`), and can see hidden slops; everything else is for admins. Every use of a staff
  power is written to `staffActions` with `logStaffAction` in the same mutation, and admins read it at /mod/team.
  ADMIN_IDENTITIES lists sign-in accounts (`github:1160934`), never usernames, which anyone can take: whoever signs in
  with one is made an admin (`grantListedAdmin`) and can't be demoted while it's listed. Roles, permissions, trust and
  the staff log never go into a public shape.
- **Promo video:** the source of the one on slop #0001 is `packages/promo` (Remotion, private, never released), and
  its README says how to render it. Its music is licensed for use, not redistribution.
- **Emails:** `users.email` holds a sign-in provider's verified address, for the daily digest only. Keep it out of
  every public shape and loader that isn't the owner's.
- **Notifications:** create them with `notify()` (`convex/lib/notify.ts`), never a bare insert: it also schedules the
  browser push (`convex/pushSend.ts`) for people who turned it on. Push text comes from `app/lib/notifications.ts`,
  shared with the notifications page.
- **Safety:** nothing auto-posts unless the slop passed the content check (`app/.server/moderation.ts`) and has no
  open flags. Makers can't mark their own slops NSFW; the check, flags and moderators do. Keep the policy prompt
  stable: it's the cached prefix of every call. The check goes through OpenRouter (`OPENROUTER_MODEL`, DeepSeek V4.1
  Flash by default), so switching models is config only.
  New launches and content edits are hidden until a matching full check lands. `publishAfterCheck` remembers whether
  that check may reveal them, preserving moderator hides. Upload verdicts never lift this hold. Public reads use
  `isHidden`, which also holds legacy rows with no verdict. Rechecks include the original launch note from Convex.
- **Security invariants** (from the 2026-10 audits; `tests/security.test.ts` and `e2e/security.spec.ts` pin them):
  - Every public Convex function calls an auth gate (`requireServer`, `viewer…`) — a bounded public read is the only
    exception and belongs in that test's `OPEN_FUNCTIONS` list, with a cap on what it returns.
  - Anything an anonymous visitor can reach that costs Convex work — a write, a bearer lookup, a model call, a card
    render — gets a per-address ceiling first (`allowAction` in `app/.server/tokens.ts`), and sweeper tables (`crons.ts`)
    must reschedule while pages stay full, or a flood outgrows the sweep.
  - The analytics ingest endpoints (`/a/e`, `/a/r`) are public with ceilings in
    `packages/analytics/src/component/lib/limits.ts`: raise a cap only with a reason, the tests bound them.
  - Share cards render only their canonical `?v=` (`app/lib/cards.ts`); anything else 301s to it.
  - Outbound fetches to addresses people type go through the pinned transport (`publicFetch` in
    `app/.server/preview.ts`): the public-address check happens inside the DNS lookup the socket connects with, so
    DNS rebinding can't slip a private address past a check-then-fetch. Never `fetch()` a user-supplied host directly.
  - The CSP is nonce-based (`app/.server/csp.ts`): no `unsafe-inline` in `script-src`. Raw HTML goes only through the
    markdown sanitizer (`app/components/Shared.tsx`), the one `dangerouslySetInnerHTML` the test allows.
  - `safeReturnTo` (`app/.server/auth/oauth.ts`) rejects control characters: browsers strip tabs from URLs, and
    `/\t//evil.com` would leave the site.
  - Content-check verdicts are cleared when the checked content changes (`convex/slops.ts` `edit`): a failed re-check
    must leave a slop held, never a stale "ok".
- **Two-step sign-in** (`app/.server/auth/twoFactor.ts`, `convex/security.ts`): anyone with a confirmed authenticator
  app or a passkey passes `/login/verify` after OAuth; `secondFactorGate` runs before every `startSession`. Sessions
  carry `verifiedAt`, and anything that hands out access or posts on the person's behalf calls `requireRecentAuth`
  first (API tokens, CLI approval, linking and connecting accounts, credential forms, studio feeds, webhooks, the
  calendar feed and the security page itself): add it to new actions like those. TOTP secrets are sealed, each step
  and recovery code works once, and tries are capped per step and per person. Passkeys need a real domain: WebAuthn
  refuses IP addresses, so e2e covers the app and recovery codes only.
- **Sign-in:** every OAuth provider is one spec in `app/.server/auth/oauth.ts` with one redirect URI; the flow (`login`,
  `link`, `connect`) is stored with the pending authorization, never put in the URL. Linking rules live in
  `convex/users.ts` (`linkIdentity`/`unlinkIdentity`): one identity per provider, never the last one removed.
- **Search** (`convex/search.ts`) fuses Convex full-text matches (one search index per field) with vector search on
  `slopEmbeddings`, made by a Convex action through OpenRouter when a slop launches or its text changes. Results go
  through `toCards`, so hidden and NSFW slops follow the wall's rules. The wall keeps search and picked categories in the
  URL (`app/lib/wall.ts`).
- **Analytics** are first-party (`packages/analytics`, private): a Convex component mounted in
  `convex/convex.config.ts`, so events, people and sessions stay in this deployment. Browsers post straight to its HTTP
  actions (`<deployment>.convex.site/a/e`, mounted in `convex/http.ts`); key product events are captured in their
  mutations with `captureFor` (`convex/analytics.ts`). Signed-in people's distinct id is their user id. A component
  function without a `returns` validator types as `any` for the app: give every one a validator. Components can't call
  `paginate()` on a real backend (convex-test lets them): page by index key with `pageByKey`
  (`packages/analytics/src/component/lib/paging.ts`). Tests build the app
  with `convexApp()` (`tests/convexApp.ts`), which registers the component. Codegen needs a deployment, the component
  included: in a worktree without `.env.local`, run it against a scratch local backend.
- **Analytics rollups:** a daily cron (`analytics.rollUp`, 04:00 UTC) rolls each finished day into rollup rows, and
  web, unfiltered trends and projects read whole past days from them, raw events only for today and the partial day
  at the start (packages/analytics README, "Daily rollups"). Keep dashboard ranges whole days long
  (`from: now + 1 - days * DAY`, `to: now + 1`) so the period before reads rollups too. Anything new that writes or
  deletes events or sessions calls `markChanged` (`component/lib/rollupDays.ts`). Backfill with
  `convex run analytics:rollUp '{"lookbackDays": 365}'`.
- **Analytics by slop:** events on a slop's page (`/@username/slug`) and the votes, pledges, updates and comments on it
  carry the group `slop:<id>` (`groupsForPaths` in `convex/http.ts`, `slopGroup` in `convex/analytics.ts`). Makers
  see theirs at `/@username/slug/analytics`, through the `slop_analytics` operation (MCP, REST
  `/api/v1/slops/:slop/analytics`) and `slopper analytics <slop>`; their own visits don't count.
- **Platform analytics** are for admins only (`analytics.view`): the dashboard at `/analytics` (growth, slops doing
  better, traffic, insights, people), and for agents `slopper admin analytics [report]` (`GET /api/v1/admin/analytics`,
  `app/.server/agent/adminAnalytics.ts`). That command is deliberately undocumented outside this file: it's not an MCP
  tool, nor in llms.txt, the skill or `slopper help`, and the endpoint is a 404 for everyone else. Reports: overview,
  growth, projects, traffic, trends, funnel, retention, paths, stickiness, lifecycle, people, person (`--q @username`),
  live, events; flags as on /analytics/insights (`--days`, `--event` repeated, `--math`, `--breakdown`…). To improve
  the platform from data, start with `slopper admin analytics overview` and `slopper admin analytics funnel --event …`.
- **Feature flags and experiments** are made by admins at `/analytics/flags` and `/analytics/experiments` (logged in
  the staff log) and read by agents with `slopper admin analytics flags|experiments|experiment --q <key>`. The app
  server evaluates flags while it renders (`app/.server/flags.ts`, definitions kept in memory for 30s and used for up
  to 5 minutes while they're read again), so code reads them with `useFeatureFlag` and the first render already has
  them. Signed-in people are bucketed by user id, everyone else by the `sa_id` cookie, which the root middleware
  (`analyticsMiddleware`) sets on a visitor's first page unless they opted out. New targetable properties go in
  `flagProperties` and `FLAG_PROPERTIES` (`app/lib/flagForm.ts`) together.
- **Session replay:** the SDK records a share of sessions (`ANALYTICS_REPLAY_RATE`, every one unless set) with rrweb,
  loaded only for those sessions, and posts chunks to `<deployment>.convex.site/a/r`; the component keeps them in its
  file storage for 30 days. Admins watch them at `/analytics/recordings` and on each session's page. Fields are
  masked, hidden inputs and `[data-no-capture]`/`[data-no-replay]` elements are blocked out, query strings are cut
  from every address, and private pages aren't recorded (`mayRecordPath` in `app/lib/analytics.ts`). A new page
  that shows something only its owner should see goes in `mayRecordPath`, or marks that part `data-no-replay`.
- **Heatmaps:** the SDK sends every click's spot as `$heatmap` points per page; `/analytics/heatmaps` draws the page
  as it is now in a same-origin frame (the CSP's `frame-src`/`frame-ancestors 'self'` allow only that, and analytics
  doesn't run in frames) with the clicks, scroll depth and most-clicked elements for phones, tablets or desktops.
  Agents: `slopper admin analytics heatmap --path /wall --device mobile`.
- **Errors:** browsers report uncaught errors, unhandled rejections and what the root error boundary catches; the app
  server reports errors in loaders, actions and rendering (`handleError` in `app/entry.server.tsx` →
  `app/.server/errors.ts` → `analytics.captureServerError`). All are `$exception` events grouped by fingerprint
  (type and message with numbers, ids and values taken out) at `/analytics/errors`, each issue linked to the sessions
  it happened in and their recordings. Agents: `slopper admin analytics errors`, then `error --q <fingerprint>`. Catch
  an error you handle but still want to know about with `useAnalytics()?.captureException(error)`.
- **Speed:** the SDK measures the landing page's Core Web Vitals with `web-vitals` (its own lazy chunk) and sends them as
  `$webVitals` when the page is hidden. `/analytics/speed` shows each vital's 75th percentile with Google's ratings, and
  per page; agents read it with `slopper admin analytics vitals`. Check it after changing what a page loads.
- **Studio** (`/studio`, docs/social-posting.md lists every feature): one post sent as many connected accounts on
  many networks. Convex keeps `socialPosts` and one `socialDeliveries` row per account (`convex/social.ts`); the app
  server claims due rows (leased, staggered by `notBefore`, reposts after their original), sends through the
  network's adapter (`app/.server/social/`), then the thread and first comment as replies (`followUps`). Never resend
  a delivery marked `uncertain`. Network limits and capabilities live in one table, `app/lib/networks.ts`; add a
  network there, then its adapter (`send`, optional `resume`/`metrics`/`reply`/`remove`/`comments`). Nothing public
  goes out without an `ok` content check: posts, threads, first comments, auto-plug text and comment replies. Drafts
  skip the check until they're posted. Settings, snippets, brand voices, tracked links (`/go/:code`), preview links
  (`/review/:token`, public, ceilinged) and RSS feeds are in `convex/studio.ts`. Webhook and feed addresses are typed
  by people, so they go through the pinned transport. Agents use `create_social_post` (with idempotency keys).
  What each account posts (its words in `overrides`, link, media and first comment in `variants`, its time in
  `times`) and whether it's ready come from `app/lib/destinations.ts` (`destinationFor`, `readiness`), shared by the
  composer, `saveStudioPost` and the agents; a `block` issue is refused on save. Two X accounts never post the same
  words (X's automation rules). Uncertain deliveries wait for the person to resolve them (`social.resolveUncertain`).
  Setup steps per network are `app/lib/setupGuides.ts`, mirrored in docs/social-setup.md. Reddit connects by OAuth
  (`REDDIT_CLIENT_*`, refreshed in `redditCredentials`); LinkedIn Pages need `LINKEDIN_PAGES=true` after LinkedIn
  approves the Community Management API.
- **Traction:** sources are one client each in `app/.server/integrations/` (registered in `index.ts`), read only.
  Syncs run on the app server (it holds the sealing key); Convex stores days in `metrics` and hands due sources out
  with `integrations.claim`. Numbers on the page always say where they came from; typed-in money stays in the ledger.
- **Made with tags** (`app/lib/tags.ts`): kinds (model, harness, framework, platform, other) and known tags with
  aliases are hardcoded there; add kinds or tags there (a kind also needs a `.tag-kind-…` colour in app.css). Slops
  store names, cleaned with `cleanTags`; write them through `retag` (`convex/lib/tags.ts`), which keeps the counts in
  `madeWithTags` that rank suggestions. People's own tags are suggested once `SUGGEST_AFTER_USES` slops use them.
- **Product pages:** a linked demo video (`demo`, not the uploaded promo `video`) is stored as `{ provider, id }` and embed URLs are built in `app/lib/video.ts`, never taken
  from input. AI drafts (`app/.server/draft.ts`) only fill the form; saving runs the content check as usual.
- **Reviews** (`convex/reviews.ts`): people who tried a slop say how it went (works, mixed, broken) with up to 4
  screenshots, one per person per launch. `postReview` (`app/.server/reviews.ts`) runs the content check first: blocked
  is never saved, anything else goes up at once with no moderator queue (mature ones blurred like NSFW). Makers can't
  review or delete reviews of their own slops; authors and admins (`reviews.deleteAny`) can delete them. Reviews aren't
  comments: they don't depend on `COMMENTS_ENABLED`.
- **Surveys:** admins set them up at `/analytics/surveys` (one question: a rating, 0–10, a choice or words, with an
  optional follow-up; pages by path prefix; anyone, signed in or visitors; a delay), logged in the staff log. The root
  loader hands running ones to pages (`app/.server/surveys.ts`, kept in memory like flags with `remembered`,
  `app/.server/memory.ts`) unless analytics is off; `SurveyCard` asks the first one this browser hasn't answered or
  closed (remembered in localStorage). Answers are `$surveySent` events, so results come from the `survey` insight.
  Agents: `slopper admin analytics surveys`, then `survey --q <key>`.
- **Charts** are ECharts (`app/components/analytics/EChart.tsx`): the library is its own chunk
  (`echarts.client.ts`, only what's used, SVG renderer), loaded once a chart mounts, so public pages never fetch it.
  Colours come from the tokens in either theme; every chart keeps a table behind it. They animate unless motion is
  turned down: `useReducedMotion` (`app/lib/motion.ts`) follows Settings → Motion (the `slopper_motion` cookie, rendered
  as `<html data-motion>`) or the device's `prefers-reduced-motion`; app.css stills everything else the same way.
  Lines compare with the period before (trends `compare`, web and slop reports' `previousSeries`).
- **Markdown fields** (description, launch note, updates, reviews, comments) are `MarkdownEditor`
  (`app/components/MarkdownEditor.tsx`): the server renders a plain textarea, and the browser swaps in a canvist editor
  (`@canvist/web`, loaded lazily from `app/lib/canvist.client.ts`) that formats Markdown as it's typed. The hidden
  textarea keeps the Markdown the form sends, tidied by `tidyEscapes` (`app/lib/editorMarkdown.ts`); a field whose
  content the editor would change (`readsTheSame`) stays a textarea. The CSP allows `'wasm-unsafe-eval'` for it. E2E
  types into them with `write()` from `e2e/fixtures.ts`, never `fill()`. New Markdown fields use `MarkdownEditor`.
- **Comments are on** (`COMMENTS_ENABLED`, `config.commentsEnabled`, set in `monosecret.toml` and on Convex). Keep
  anything that shows or writes comments behind the switch. A new comment runs the content check in `postComment`
  (`app/.server/comments.ts`): blocked is refused and never saved, only `ok` shows at once, and `mature`/`unchecked`
  wait hidden for a moderator. Three flags by different people hide one too. Moderators decide at /mod
  (`convex/comments.ts`): approving clears it and trusts its author (`commentTrust`), whose later comments skip the
  check and the hourly cap; removing deletes it. Every decision is logged. Comments from before the check have no
  `check` and show as they always did.
- **Releases:** every change worth releasing gets a changeset, made with `vp exec monochange create` and named with
  `--output .changeset/<name>.md` (the global `monochange` is older). `user_feat` (minor), `user_fix` (patch), `user_change`
  (minor: works differently, nothing to do) and `user_breaking` (major: people must act) are for what people using the
  site notice and become `/changelog` (`app/changelog/<version>.json`); every other type (`feat`, `fix`, ...) goes to
  `CHANGELOG.md`. Write two changesets when both audiences care. Never hand-edit `app/changelog/`,
  `CHANGELOG.md` or `.monochange/releases/`: monochange owns them. A release is a pull request:
  `vp exec monochange run release` (from a clean main) commits it on `chore/release` and opens it; it merges itself
  once its `ci` check reports (`release-merge.yml`, which dispatches the release workflow for its bot merge), so
  publishing and deploying need no second step. `run publish` only runs in the release workflow.
- **Voice:** the tagline is "Too much slop? Not enough yet!"; how it works is throw slop at the wall, keep slopping until
  it's slopcessful. Plain words; no restaurant metaphors.
