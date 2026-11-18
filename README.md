# Slopper

**Too much slop? Not enough yet!** [slopper.day](https://slopper.day)

Slopper is where you throw slop at the wall every day: set a goal (30 slops in 30 days), ship something every day, show
it to people, and keep slopping until one of them is **slopcessful**.

- **Goals on a board of days.** Every day you ship flips its tile to a "!". Days are UTC days, ending at midnight UTC for everyone.
- **Slop of the day.** Each UTC day is a race on votes (5 each a day); a cron crowns the winner after midnight, and
  winning makes it slopcessful.
- **Scheduled launches.** Ready with three? Throw one now and line the others up: each goes out on its next free day
  as that day's race starts, or at a time you pick, and counts towards the goal on the day it goes out.
- **Launches, not just products.** The website, then the iOS beta, then 2.0: each launch is its own entry and its own
  shot at slop of the day, linked to the product.
- **Updates, feature drops, re-promotes and field tests.** Field tests log real people trying it, and count extra.
- **Votes** with private downvotes and **live notifications**. **Feedback** and **kudos** on every slop, with moderation:
  each comment passes the content check, blocked ones are refused, anything mature or unchecked waits for a moderator,
  and people can flag comments. A moderator approving someone's comment trusts them, so their later comments skip the
  check and the hourly cap. `COMMENTS_ENABLED` turns it on (`true` in production).
- **Safe for work.** Every launch, screenshot and auto-posted update gets an automated content check. Screenshots are
  checked as they're uploaded: explicit or hateful images (text in them included) are refused and never stored, and a
  mature one blurs any slop that shows it. Mature slops are blurred, anything worse is held for a moderator, and nothing
  auto-posts until it passes. Anyone signed in can flag a slop; moderators decide at `/mod`.
- **Publications.** Wrote a book, zine, guide or paper? A slop can carry it as one PDF or EPUB (up to 4 MB), read from
  its page, with or without links. Before anything else, Slopper's own safety scan refuses a file that could do more
  than show pages. For PDFs (`app/.server/pdfSafety.ts`): scripts, actions that run when it's opened, forms that send
  data, attached files, encryption, other files disguised as a PDF, and anything packed where the scan can't see. For
  EPUBs (`app/.server/epubSafety.ts`): scripts, event handlers, `javascript:` links, frames and forms, anything loaded
  from the web, ZIP bombs and tricks, files a book isn't made of, programs, and DRM. Then it's checked like a
  screenshot (an EPUB by the text its scan read out): blocked ones are refused and never stored, mature ones blur the slop, and one the check couldn't
  read is read again with the launch.
- **Product pages.** Each slop can carry a demo video (YouTube, Loom or Vimeo, loaded on a click), what it does and who
  it's for. AI drafts them from the maker's words and website; the maker edits before saving.
- **Traction from the source.** Connect Google Analytics, PostHog, Stripe or a Solana wallet (USDC and USDT) and the
  slop page shows who's on it now, people and signups per day, revenue and MRR, each labelled with where it came from.
  Read only, synced while people look, each source shown or hidden by its maker.
- **Money ledger.** Costs (domain, hosting, AI) and revenue per product, private unless you show the numbers.
- **Slopcessful hall of fame:** slops that earned it. Nobody can declare it: today it comes from winning the day.
- **Auto-post** to LinkedIn and Bluesky (X is built but off: its API is pay per use), plus one-tap share
  buttons everywhere.
- **For agents:** an MCP server, a REST API, a CLI (`@slopperday/cli`) with its skill (`@slopperday/skill`) and
  a prompt on every form to pass to your agent.

Everything is live: votes, races and notifications update on every open page as they happen.

## Stack

| Piece     | Choice                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain | [Vite+](https://viteplus.dev) (`vp`): Vite 8 + Rolldown, Oxlint, Oxfmt, Vitest, tsgo                                                         |
| App       | React Router 8 framework mode, React 19, server-side rendering with web streams, ESM only                                                    |
| Styles    | Tailwind CSS 4                                                                                                                               |
| Data      | [Convex](https://convex.dev): realtime queries and crons                                                                                     |
| Media     | Screenshots and copied profile pictures in a [Backblaze B2](https://www.backblaze.com/cloud-storage) bucket (S3 API, aws4fetch)              |
| Hosting   | [Netlify](https://www.netlify.com): static files on the CDN, the server as one Netlify Function, deployed by GitHub Actions                  |
| Auth      | GitHub, Google, LinkedIn and Facebook OAuth (X built, off for cost); the app signs ES256 JWTs that Convex verifies (`convex/auth.config.ts`) |
| Safety    | DeepSeek V4.1 Flash through [OpenRouter](https://openrouter.ai) reads text and screenshots; the policy is a fixed, cached prefix             |
| Secrets   | [Monosecret](https://ifiokjr.github.io/monosecret/) reads production secrets from one 1Password item and sets them on Netlify                |
| Tests     | Vitest (logic, Convex functions) and Playwright (journeys against the production build)                                                      |

Convex gives 1M function calls and 0.5 GB of database free; Backblaze B2 stores the first 10 GB free. Netlify's free
plan is 300 credits a month, and each production deploy costs 15 of them (bandwidth is 20 per GB, 10k requests 2), so a
busy month of releases wants the Personal plan.

## Develop

Needs Node 24+ and pnpm (or just `vp`).

```bash
vp install
vp run convex          # local Convex backend; no account needed. Leave it running.
vp run keys            # once: signing keys in .env.local, public key in Convex
vp run vapid           # optional: browser notifications (both halves in Convex, public in .env.local)
vp dev                 # http://localhost:5173
```

Locally there's a password-free **dev login** on `/login`. OAuth providers light up when their keys are set (see
`.env.example`). Without the B2 variables, screenshots go to Convex file storage.

```bash
vp check               # oxfmt, oxlint and type-aware checks
vp test                # Vitest, including Convex functions via convex-test
vp build               # production bundles in build/
vp run start           # serve build/ like Netlify does (scripts/serve.ts), with .env.local
vp run e2e             # build, then the Playwright journeys
vp run ci              # everything CI does: typegen, check, test, build, e2e
```

CI defaults to local. `vp install` sets up git hooks: pre-commit runs `vp staged` (format and lint the staged files)
and pre-push runs `vp run ci`. If hooks aren't active in a fresh clone, run `vp hooks enable`.

The authorized security repairs can use hosted checks instead: the `security-ci` PR label opts into
[the security CI workflow](.github/workflows/ci.yml), which runs the same full gate on a fresh runner with every
supported CLI runtime and package runner installed. It can also run manually. Ordinary PRs skip the hosted job.
The local pre-push rerun is waived for those repairs; every hosted gate and review must pass before merging.

The Playwright journeys (`e2e/`) run against the production build (the Netlify Function under Node), with a throwaway Convex backend, a
fake content check and a fake B2 bucket that checks every request's signature, all started by `e2e/stack.ts`. They
need Playwright's Chromium (`node_modules/.bin/playwright install chromium`), and the Convex backend binary, which
`vp run convex` downloads the first time. Your dev data on :3210 is never touched.

## Deploy

1. **Convex.** `npx convex login`, then `npx convex deploy` to create the production deployment. Run
   `APP_URL=https://slopper.day node scripts/convex-keys.ts --prod --print` to give Convex the public key and print the
   private key for the app.
2. **Netlify.** `vp exec netlify login`, then `vp exec netlify sites:create --name slopper-day` (`slopper` is taken).
   No Git connection: Netlify never builds; the release workflow (or this machine) does (`netlify.toml`). Functions
   run in Ohio (`cmh`), next to Convex.
3. **Environment.** `monosecret.toml` declares every production variable. Plain ones (`APP_URL`, `CONVEX_URL`, OAuth
   client ids, the bucket, the VAPID public key) are defaults there; secrets are fields of the "production" section of
   the 1Password item "Slopper" (Development vault), named after each variable: `SLOPPER_JWT_PRIVATE_KEY`,
   `SLOPPER_SECRET_KEY`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, the OAuth client secrets, and `OPENROUTER_API_KEY` (the
   content check; without it nothing is ever auto-posted). Put a service account token that can read the item in
   `.env.monosecret` as `OP_SERVICE_ACCOUNT_TOKEN=...`, then `vp run env:netlify` sets them all on Netlify (secrets as
   Netlify secrets, production only). `vp run env:netlify --dry-run` lists them without reading 1Password. `COMMENTS_ENABLED` is `true` by default in
   `monosecret.toml`; set it on Convex too (`npx convex env set --prod COMMENTS_ENABLED true`), because the page query
   reads Convex's own environment. Both deployments must agree: a page query cannot enable comments on its own.
4. **Backblaze B2** for screenshots (see below).
5. **Deploy.** Add a Convex production deploy key (dashboard → Settings → Deploy keys) to the item's "deploy" section as
   `CONVEX_DEPLOY_KEY`. `node scripts/release.ts deploy` deploys Convex with it, then builds here and deploys Netlify.
   Releases do the same in GitHub Actions (see Release), which needs two repository secrets: `CONVEX_DEPLOY_KEY` and
   `NETLIFY_AUTH_TOKEN` (a Netlify personal access token).
6. **Domain.** Add `slopper.day` to the Netlify project (Domain management) and point its DNS at Netlify.

### Screenshots in Backblaze B2

The app server checks every upload, then writes it to the bucket through B2's S3-compatible API; browsers load images
straight from the bucket's public URL. Without these variables, screenshots go to Convex file storage.

1. **Bucket.** In the B2 console, Buckets → Create a Bucket (say `slopper-media`), files in bucket **Public** (B2 may ask
   you to verify your email first). Under Lifecycle Settings, pick "Keep only the last version of the file": deleting
   through the S3 API hides a file, and this rule removes hidden files a day later. No CORS rules are needed: uploads go
   through the app server, and `<img>` tags don't need CORS.
2. **Application key.** Application Keys → Add a New Application Key, allowed access to that one bucket only, type of
   access Read and Write. The app only needs `writeFiles` and `deleteFiles`, so with the B2 CLI:
   `b2 key create --bucket slopper-media slopper-app writeFiles,deleteFiles`. The account's master key doesn't work with
   the S3 API.
3. **In `monosecret.toml` and 1Password**, set `B2_ENDPOINT` (the bucket's S3 endpoint, e.g. `https://s3.us-west-004.backblazeb2.com`),
   `B2_REGION` (the part after `s3.`, e.g. `us-west-004`), `B2_BUCKET`, `B2_KEY_ID` (the key's keyID) and
   `B2_APPLICATION_KEY` (its applicationKey, shown once). Set all five or none: a partial set stops the server.
4. **On Convex**, set where images are served from. Convex builds the image URLs pages receive, so this one lives there:
   `npx convex env set --prod MEDIA_PUBLIC_URL https://f004.backblazeb2.com/file/slopper-media` (the "Friendly URL" of
   any file in the bucket, minus the file name). Put a CDN in front later by changing only this; uploads are refused
   until it's set.

### Search

The wall's search box (and agents' `search_slops`) matches words and meaning. Convex full-text search ranks matches in
each slop's name, tagline and description; vector search finds slops that mean what was asked without sharing its words
("budget" finds an expense tracker). Both rankings merge into one (`convex/search.ts`). The vectors come from
`openai/text-embedding-3-small` through OpenRouter, made by a Convex action when a slop launches or its text changes.

1. On Convex: `npx convex env set --prod OPENROUTER_API_KEY sk-or-…` (the same key as the content check).
2. Once, to embed the slops launched before: `npx convex run --prod search:backfill`. Run it again if it stops; it
   skips slops that are done.

Without the key, search matches words only.

### Daily digest email

Once a day, at 9am in each person's time zone, Slopper emails what happened to their slops since the last digest:
upvotes, pledges, feedback, wins. Only unread notifications count, and days with nothing new send nothing. It goes to
the verified address a sign-in provider shared (Google, GitHub, LinkedIn or Facebook; X shares none), with a one-click
unsubscribe. People turn it off in Settings or from any digest.

Convex runs it every hour (`convex/digest.ts`); `convex/digestSend.ts` renders each email with
[react-email](https://react.email) (`app/emails/digest.tsx`, on brand, with a plain-text part) and sends the batch
through [Resend](https://resend.com), whose free plan covers 3,000 emails a month and 100 a day. Preview emails with
`vp run email` (http://localhost:3030).

1. Sign up for Resend and add the domain `slopper.day`. Add the DNS records it shows: a DKIM `TXT` on
   `resend._domainkey`, and an `MX` and `TXT` on `send` for bounces. None of them touch the root's Google mail.
2. Create an API key with sending access to that domain only.
3. On Convex: `npx convex env set --prod RESEND_API_KEY re_…`. Optional: `APP_URL` (where links point, default
   `https://slopper.day`) and `DIGEST_FROM` (default `Slopper <digest@slopper.day>`).

Without `RESEND_API_KEY` the hourly job does nothing, and digests start where they left off once it's set.

### Browser notifications

Upvotes, pledges, feedback and slop of the day reach people's browsers through Web Push, which costs nothing: each
browser's own push service (Google's, Mozilla's, Apple's, Microsoft's) delivers them. People turn it on per browser in
Settings; on iPhone, Slopper has to be added to the Home Screen first.

Run `node scripts/vapid-keys.ts --prod --print` once. It sets `VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY` on Convex, which signs and sends every push from a Node action (`convex/pushSend.ts`), and prints
`VAPID_PUBLIC_KEY` for `monosecret.toml`, which sends it to Netlify, where browsers subscribe with it. New keys cut off every browser subscribed with the
old ones. `VAPID_SUBJECT` (Convex) defaults to `mailto:hello@slopper.day`.

Objects get random keys under `screenshots/` (or `avatars/`, `videos/`, `publications/`) and `Cache-Control: public, max-age=31536000, immutable`. When a deleted
or edited slop leaves a screenshot unused, Convex marks it orphaned and the app server deletes the object, then its
row. One the bucket won't delete stays marked and is retried the next time a delete or edit orphans another.

### Traction integrations

Makers connect their own sources on a slop's edit page (`#traction`). Each connection's first sync runs before it's
saved, so a refused key is never stored; keys are sealed with `SLOPPER_SECRET_KEY`. Syncs run on the app server
(`app/.server/integrations/`), because only it can unseal keys: a slop page with numbers older than five minutes posts
to `/api/slops/:id/traction`, Convex hands each due source out once, and the live query flips the board.

- **Stripe:** a restricted key with Read on Balance and Subscriptions. Secret keys are refused.
- **PostHog:** a personal API key with Query Read, the project id and region.
- **Solana wallet:** just the address. `SOLANA_RPC_URL` picks the RPC (the public endpoint by default).
- **Google Analytics:** set `GOOGLE_ANALYTICS_SERVICE_ACCOUNT` to a service account's JSON key, with the Analytics Data
  API enabled in its project. Makers add its email as a Viewer on their property. Without it, Google Analytics isn't
  offered.

AI drafts of product pages use the content check's OpenRouter settings; without `OPENROUTER_API_KEY` the button is
hidden.

### OAuth apps

Every provider has one callback URL. Signing in, linking a sign-in method from Settings and connecting an account for
auto-posting all come back to it: the app remembers which flow it started, so register the URL once. A provider's button
appears on `/login` (and in Settings) only when both of its keys are set.

| Provider | Keys                                           | Where                                                            | Callback URL                                 | Notes                                                                                                                                                                                                      |
| -------- | ---------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`     | Settings → Developer settings → OAuth Apps                       | `https://slopper.day/auth/github/callback`   | Sign in.                                                                                                                                                                                                   |
| Google   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     | Google Cloud console → Credentials → OAuth client (Web)          | `https://slopper.day/auth/google/callback`   | Sign in. Scopes: openid, email, profile.                                                                                                                                                                   |
| X        | `X_CLIENT_ID`, `X_CLIENT_SECRET`               | developer.x.com → app → User authentication (OAuth 2.0, Web App) | `https://slopper.day/auth/x/callback`        | Sign in (users.read, tweet.read; X shares no email) and auto-post (tweet.read, tweet.write, users.read, offline.access). **Pay per use:** a post with a link costs about $0.20, so it's off in production. |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | linkedin.com/developers → app → Products                         | `https://slopper.day/auth/linkedin/callback` | Add "Sign In with LinkedIn using OpenID Connect" (sign in: openid, profile, email) and "Share on LinkedIn" (auto-post: openid, profile, w_member_social). Posting tokens last 60 days.                     |
| Facebook | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | developers.facebook.com → app → Use cases → Facebook Login       | `https://slopper.day/auth/facebook/callback` | Sign in (public_profile, email). See below.                                                                                                                                                                |
| Bluesky  | None                                           | Nothing to register                                              |                                              | People connect with an app password.                                                                                                                                                                       |

**Facebook:** the keys are the app's App ID and App Secret. Add the callback under Facebook Login → Settings → Valid
OAuth Redirect URIs, turn on "Require App Secret" (the server signs its Graph calls with `appsecret_proof`), and use
`https://slopper.day/privacy` as the privacy policy and data deletion instructions URL. Instagram has no consumer
sign-in any more (Instagram Login is for professional accounts), so Facebook covers Meta.

Email addresses are read only to suggest a username for a new account, and never stored. LinkedIn and Facebook
pictures are copied into media storage (B2, or Convex storage locally) when an account is made, because their links
expire. The copy is checked like a screenshot, and a mature one is refused too, since avatars are never blurred.

## Release

Releases are planned by [monochange](https://github.com/monochange/monochange), configured in `monochange.toml` and
pinned in `devDependencies`, so run it with `vp exec monochange`. Every change worth releasing gets a changeset in
`.changeset/`, and its type picks the audience:

- `user_feat` (new, minor), `user_fix` (fixed, patch), `user_change` (works differently, minor) and `user_breaking`
  (people must act, major) are what people using slopper.day notice. They become the release notes on
  [/changelog](https://slopper.day/changelog), one JSON file per release in `app/changelog/`.
- Every other type (`feat`, `fix`, `major`, `minor`, `patch`, `docs`, `refactor`, `test`, `none`, ...) is a developer
  note in `CHANGELOG.md`.

A change both audiences care about gets two changesets. Name each one with `--output`.

```bash
vp exec monochange create --package slopper --type user_feat --reason "Pin your best slop" --output .changeset/pin-slops.md
vp exec monochange run release --dry-run   # the next version and its notes
vp exec monochange run release             # on a clean, up-to-date main: open the release pull request
```

A release is a pull request. `run release` commits the version bumps and both changelogs on `chore/release`, pushes it
(the pre-push hook runs CI, and a failure pushes nothing) and opens the pull request, or updates the open one.

Merging it runs [`.github/workflows/release.yml`](.github/workflows/release.yml), the release workflow:
it tags the release (`v1.2.3` for the site, `cli/v1.2.3` for the npm packages), deploys Convex and then Netlify when the
site is in the release, waits until slopper.day answers with the new `x-slopper-version` header, and publishes the
released npm packages with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so there's no npm
token anywhere. Every other push to main skips it. Manual runs, including dry runs, must use `main` and a release
commit already merged there. To retry a failed publish, untick "dry run" and supply the full release commit SHA
if it is no longer the newest commit on `main`. A new npm package needs
`vp exec monochange publish placeholder` once and `npm trust github <package> --file release.yml --repository
slopperday/slopper --environment production --allow-publish` before its first release.

Publishing also depends on server-side policy: the GitHub `production` environment allows only the `main` branch,
and holds `CONVEX_DEPLOY_KEY` and `NETLIFY_AUTH_TOKEN`. Neither secret may remain at repository scope. Every npm
trusted publisher must require the `production` environment; remove older connections without that requirement.
These controls also constrain historical workflow versions on other branches, which cannot be secured by editing
today's workflow alone. The release guard validates the requested commit before any dependency install.
Main's source policy is defined in `.github/release-authority.json`: updates require pull requests, and deletion
and force pushes are blocked. `.github/release-validation.json` independently requires GitHub Actions' `ci` check.
Neither ruleset has bypass actors. Merge through the normal organization pull request path after the exact head's
full CI, review and required approvals pass; do not use administrative overrides or alter protections.

## For agents

- MCP (Streamable HTTP): `claude mcp add --transport http slopper https://slopper.day/mcp --header "Authorization: Bearer <token>"`
- REST: `https://slopper.day/api/v1/*` with the same bearer token
- Guide: [`/llms.txt`](https://slopper.day/llms.txt). Tokens are created at `/settings/api`.

## Layout

```
app/            React Router app: routes, components, shared lib, .server/ (server-only)
convex/         schema, queries, mutations, crons, auth config
scripts/        key generators, serve.ts (the production build, locally), netlify-env.ts, release.ts
netlify.toml    the Netlify build; monosecret.toml lists its environment
tests/          Vitest suites (pure logic and Convex functions)
```

See [ROADMAP.md](ROADMAP.md) for what's next.
