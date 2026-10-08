# Slopper

**Throw slop at the wall. Every day.** [slopper.day](https://slopper.day)

Everyone says slop is bad. Everything good started as slop, and now you can make it at scale. Slopper is where you set a
goal (30 slops in 30 days), ship something every day, show it to people, and keep slopping until one of them is
**slopcessful**.

- **Goals on a board of days.** Every day you ship flips its tile to a "!". Days end at midnight in your time zone.
- **Slop of the day.** Each UTC day is a race on votes; a cron crowns the winner after midnight.
- **Launches, not just products.** The website, then the iOS beta, then 2.0: each launch is its own entry and its own
  shot at slop of the day, linked to the product.
- **Updates, feature drops, re-promotes and field tests.** Field tests log real people trying it, and count extra.
- **Votes** with private downvotes and **live notifications**. **Feedback** and **kudos** are built but off for V1:
  they come back with heavier moderation (`COMMENTS_ENABLED=true` turns them on).
- **Safe for work.** Every launch, screenshot and auto-posted update gets an automated content check. Screenshots are
  checked as they're uploaded: explicit or hateful images (text in them included) are refused and never stored, and a
  mature one blurs any slop that shows it. Mature slops are blurred, anything worse is held for a moderator, and nothing
  auto-posts until it passes. Anyone signed in can flag a slop; moderators decide at `/mod`.
- **Take my money.** Non-binding pledges that show how much people would pay.
- **Money ledger.** Costs (domain, hosting, AI) and revenue per product, private unless you show the numbers.
- **Slopcessful hall of fame** for slops that broke out.
- **Auto-post** to X (several accounts: post as the app, repost as you), LinkedIn and Bluesky, plus one-tap share
  buttons everywhere.
- **For agents:** an MCP server, a REST API and copy-paste prompts on every form, so your AI can run Slopper for you.

Everything is live: votes, races, pledges and notifications update on every open page as they happen.

## Stack

| Piece     | Choice                                                                                                                           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Toolchain | [Vite+](https://viteplus.dev) (`vp`): Vite 8 + Rolldown, Oxlint, Oxfmt, Vitest, tsgo                                             |
| App       | React Router 8 framework mode, React 19, server-side rendering with web streams, ESM only                                        |
| Styles    | Tailwind CSS 4                                                                                                                   |
| Data      | [Convex](https://convex.dev): realtime queries and crons                                                                         |
| Media     | Screenshots and copied profile pictures in a [Backblaze B2](https://www.backblaze.com/cloud-storage) bucket (S3 API, aws4fetch)  |
| Hosting   | [Deno Deploy](https://deno.com/deploy), one self-contained ESM server bundle                                                     |
| Auth      | GitHub, Google, X, LinkedIn and Facebook OAuth; the app signs ES256 JWTs that Convex verifies (`convex/auth.config.ts`)          |
| Safety    | DeepSeek V4.1 Flash through [OpenRouter](https://openrouter.ai) reads text and screenshots; the policy is a fixed, cached prefix |
| Tests     | Vitest (logic, Convex functions) and Playwright (journeys against the production build)                                          |

The free tiers are enough to launch: Deno Deploy gives 1M requests and 20 GB of egress a month; Convex gives 1M function
calls and 0.5 GB of database; Backblaze B2 stores the first 10 GB free.

## Develop

Needs Node 24+, pnpm (or just `vp`), and Deno 2 for the production server.

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
vp run start           # serve build/ with Deno, like production
vp run e2e             # build, then the Playwright journeys
vp run ci              # everything CI does: typegen, check, test, build, e2e
```

CI runs locally, not on GitHub. `vp install` sets up git hooks: pre-commit runs `vp staged` (format and lint the staged
files) and pre-push runs `vp run ci`, so nothing broken gets pushed. If hooks aren't active in a fresh clone, run
`vp hooks enable`.

The Playwright journeys (`e2e/`) run against the production build under Deno, with a throwaway Convex backend, a
fake content check and a fake B2 bucket that checks every request's signature, all started by `e2e/stack.ts`. They
need Deno, Playwright's Chromium (`node_modules/.bin/playwright install chromium`), and the Convex backend binary, which
`vp run convex` downloads the first time. Your dev data on :3210 is never touched.

## Deploy

1. **Convex.** `npx convex login`, then `npx convex deploy` to create the production deployment. Run
   `APP_URL=https://slopper.day node scripts/convex-keys.ts --prod --print` to give Convex the public key and print the
   private key for the app.
2. **Deno Deploy.** Create an app at [console.deno.com](https://console.deno.com) from this repository. Build settings
   live in the app, not in a `deno.json`: a `deploy` section there caps the build at 1 GB, which the build outgrows on
   Deno Deploy. Install `deno install`; build `deno run -A node_modules/@react-router/dev/dist/cli/index.js build`;
   dynamic runtime with entrypoint `deploy/main.ts`; build memory 2048 MB; region US, next to Convex. Set the
   environment variables from `.env.example`: `APP_URL=https://slopper.day`, `CONVEX_URL` (your `*.convex.cloud` URL),
   `SLOPPER_JWT_ISSUER`, `SLOPPER_JWT_PRIVATE_KEY`, `SLOPPER_SECRET_KEY`, `ADMIN_USERNAMES` (the moderators),
   `OPENROUTER_API_KEY` (the content check; without it nothing is ever auto-posted), the B2 variables below and the
   OAuth keys (below). Leave `COMMENTS_ENABLED` unset: comments are off for V1.
3. **Backblaze B2** for screenshots (see below).
4. **Domain.** Add `slopper.day` to the Deno Deploy app.

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
3. **On Deno Deploy**, set `B2_ENDPOINT` (the bucket's S3 endpoint, e.g. `https://s3.us-west-004.backblazeb2.com`),
   `B2_REGION` (the part after `s3.`, e.g. `us-west-004`), `B2_BUCKET`, `B2_KEY_ID` (the key's keyID) and
   `B2_APPLICATION_KEY` (its applicationKey, shown once). Set all five or none: a partial set stops the server.
4. **On Convex**, set where images are served from. Convex builds the image URLs pages receive, so this one lives there:
   `npx convex env set --prod MEDIA_PUBLIC_URL https://f004.backblazeb2.com/file/slopper-media` (the "Friendly URL" of
   any file in the bucket, minus the file name). Put a CDN in front later by changing only this; uploads are refused
   until it's set.

### Browser notifications

Upvotes, pledges, feedback and slop of the day reach people's browsers through Web Push, which costs nothing: each
browser's own push service (Google's, Mozilla's, Apple's, Microsoft's) delivers them. People turn it on per browser in
Settings; on iPhone, Slopper has to be added to the Home Screen first.

Run `node scripts/vapid-keys.ts --prod --print` once. It sets `VAPID_PUBLIC_KEY` and
`VAPID_PRIVATE_KEY` on Convex, which signs and sends every push from a Node action (`convex/pushSend.ts`), and prints
`VAPID_PUBLIC_KEY` for Deno Deploy, where browsers subscribe with it. New keys cut off every browser subscribed with the
old ones. `VAPID_SUBJECT` (Convex) defaults to `mailto:hello@slopper.day`.

Objects get random keys under `screenshots/` and `Cache-Control: public, max-age=31536000, immutable`. When a deleted
or edited slop leaves a screenshot unused, Convex marks it orphaned and the app server deletes the object, then its
row. One the bucket won't delete stays marked and is retried the next time a delete or edit orphans another.

### OAuth apps

Every provider has one callback URL. Signing in, linking a sign-in method from Settings and connecting an account for
auto-posting all come back to it: the app remembers which flow it started, so register the URL once. A provider's button
appears on `/login` (and in Settings) only when both of its keys are set.

| Provider | Keys                                           | Where                                                            | Callback URL                                 | Notes                                                                                                                                                                                  |
| -------- | ---------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub   | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`     | Settings → Developer settings → OAuth Apps                       | `https://slopper.day/auth/github/callback`   | Sign in.                                                                                                                                                                               |
| Google   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     | Google Cloud console → Credentials → OAuth client (Web)          | `https://slopper.day/auth/google/callback`   | Sign in. Scopes: openid, email, profile.                                                                                                                                               |
| X        | `X_CLIENT_ID`, `X_CLIENT_SECRET`               | developer.x.com → app → User authentication (OAuth 2.0, Web App) | `https://slopper.day/auth/x/callback`        | Sign in (users.read, tweet.read; X shares no email) and auto-post (tweet.read, tweet.write, users.read, offline.access). **Pay per use:** a post with a link costs about $0.20.        |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | linkedin.com/developers → app → Products                         | `https://slopper.day/auth/linkedin/callback` | Add "Sign In with LinkedIn using OpenID Connect" (sign in: openid, profile, email) and "Share on LinkedIn" (auto-post: openid, profile, w_member_social). Posting tokens last 60 days. |
| Facebook | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | developers.facebook.com → app → Use cases → Facebook Login       | `https://slopper.day/auth/facebook/callback` | Sign in (public_profile, email). See below.                                                                                                                                            |
| Bluesky  | None                                           | Nothing to register                                              |                                              | People connect with an app password.                                                                                                                                                   |

**Facebook:** the keys are the app's App ID and App Secret. Add the callback under Facebook Login → Settings → Valid
OAuth Redirect URIs, turn on "Require App Secret" (the server signs its Graph calls with `appsecret_proof`), and use
`https://slopper.day/privacy` as the privacy policy and data deletion instructions URL. Instagram has no consumer
sign-in any more (Instagram Login is for professional accounts), so Facebook covers Meta.

Email addresses are read only to suggest a username for a new account, and never stored. LinkedIn and Facebook
pictures are copied into media storage (B2, or Convex storage locally) when an account is made, because their links
expire. The copy is checked like a screenshot, and a mature one is refused too, since avatars are never blurred.

## For agents

- MCP (Streamable HTTP): `claude mcp add --transport http slopper https://slopper.day/mcp --header "Authorization: Bearer <token>"`
- REST: `https://slopper.day/api/v1/*` with the same bearer token
- Guide: [`/llms.txt`](https://slopper.day/llms.txt). Tokens are created at `/settings/api`.

## Layout

```
app/            React Router app: routes, components, shared lib, .server/ (server-only)
convex/         schema, queries, mutations, crons, auth config
server/app.ts   production request handler, bundled with the app
deploy/main.ts  Deno Deploy entry: static assets + handler
tests/          Vitest suites (pure logic and Convex functions)
```

See [ROADMAP.md](ROADMAP.md) for what's next.
