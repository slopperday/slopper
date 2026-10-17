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
- **Comments are off for V1** (`COMMENTS_ENABLED`, `config.commentsEnabled`). Keep their code and unit tests working, and
  gate anything that shows or writes comments on the switch.
- **Releases:** every change worth releasing gets a changeset, made with `vp exec monochange create` and named with
  `--output .changeset/<name>.md` (the global `monochange` is older). `user_feat`, `user_fix` and `user_change` are for
  what people using the site notice and become `/changelog` (`app/changelog/<version>.json`); every other type (`feat`,
  `fix`, ...) goes to `CHANGELOG.md`. Write two changesets when both audiences care. Never hand-edit `app/changelog/`,
  `CHANGELOG.md` or `.monochange/releases/`: monochange owns them. A release is a pull request:
  `vp exec monochange run release` (from a clean main) commits it on `chore/release` and opens it; merging it
  publishes. `run publish` only runs in the release workflow.
- **Voice:** the tagline is "Too much slop? Not enough yet!"; how it works is throw slop at the wall, keep slopping until
  it's slopcessful. Plain words; no restaurant metaphors.
