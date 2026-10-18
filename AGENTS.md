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
- **CI is local only.** The pre-push hook runs `vp run ci`; never add remote CI without asking (cost). The one
  workflow, `.github/workflows/release.yml`, only publishes merged release pull requests and skips every other push.
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
  `POST /api/scheduled/:id`; the app server claims it once and runs `finishLaunch` (`app/.server/launch.ts`): the
  content check, then the auto-post.
- **Votes and slopcessful:** everyone gets `LIMITS.votesPerDay` (5) votes per UTC day (`convex/slops.ts` `vote`).
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
- **Traction:** sources are one client each in `app/.server/integrations/` (registered in `index.ts`), read only.
  Syncs run on the app server (it holds the sealing key); Convex stores days in `metrics` and hands due sources out
  with `integrations.claim`. Numbers on the page always say where they came from; typed-in money stays in the ledger.
- **Product pages:** a linked demo video (`demo`, not the uploaded promo `video`) is stored as `{ provider, id }` and embed URLs are built in `app/lib/video.ts`, never taken
  from input. AI drafts (`app/.server/draft.ts`) only fill the form; saving runs the content check as usual.
- **Comments are off for V1** (`COMMENTS_ENABLED`, `config.commentsEnabled`). Keep their code and unit tests working, and
  gate anything that shows or writes comments on the switch.
- **Releases:** every change worth releasing gets a changeset, made with `vp exec monochange create` and named with
  `--output .changeset/<name>.md` (the global `monochange` is older). `user_feat` (minor), `user_fix` (patch), `user_change`
  (minor: works differently, nothing to do) and `user_breaking` (major: people must act) are for what people using the
  site notice and become `/changelog` (`app/changelog/<version>.json`); every other type (`feat`, `fix`, ...) goes to
  `CHANGELOG.md`. Write two changesets when both audiences care. Never hand-edit `app/changelog/`,
  `CHANGELOG.md` or `.monochange/releases/`: monochange owns them. A release is a pull request:
  `vp exec monochange run release` (from a clean main) commits it on `chore/release` and opens it; merging it
  publishes. `run publish` only runs in the release workflow.
- **Voice:** the tagline is "Too much slop? Not enough yet!"; how it works is throw slop at the wall, keep slopping until
  it's slopcessful. Plain words; no restaurant metaphors.
