# Slopper

**Throw slop at the wall. Every day.** [slopper.day](https://slopper.day)

Everyone says slop is bad. Everything good started as slop, and now you can make it at scale. Slopper is where you set a
goal (30 slops in 30 days), ship something every day, show it to people, and keep slopping until one of them is
**slopcessful**.

- **Goals with a splat grid.** Every day you ship leaves a splat. Days end at midnight in your time zone.
- **Slop of the day.** Each UTC day is a race on votes; a cron crowns the winner after midnight.
- **Launches, not just products.** The website, then the iOS beta, then 2.0: each launch is its own entry and its own
  shot at slop of the day, linked to the product.
- **Updates, feature drops, re-promotes and field tests.** Field tests log real people trying it, and count extra.
- **Votes** with private downvotes, **feedback** and **kudos**, **live notifications**.
- **Take my money.** Non-binding pledges that show how much people would pay.
- **Money ledger.** Costs (domain, hosting, AI) and revenue per product, private unless you show the numbers.
- **Slopcessful hall of fame** for slops that broke out.
- **Auto-post** to X (several accounts: post as the app, repost as you), LinkedIn and Bluesky, plus one-tap share
  buttons everywhere.
- **For agents:** an MCP server, a REST API and copy-paste prompts on every form, so your AI can run Slopper for you.

Everything is live: votes, races, feedback, pledges and notifications update on every open page as they happen.

## Stack

| Piece     | Choice                                                                                           |
| --------- | ------------------------------------------------------------------------------------------------ |
| Toolchain | [Vite+](https://viteplus.dev) (`vp`): Vite 8 + Rolldown, Oxlint, Oxfmt, Vitest, tsgo             |
| App       | React Router 8 framework mode, React 19, server-side rendering with web streams, ESM only        |
| Styles    | Tailwind CSS 4                                                                                   |
| Data      | [Convex](https://convex.dev): realtime queries, file storage for screenshots, crons              |
| Hosting   | [Deno Deploy](https://deno.com/deploy), one self-contained ESM server bundle                     |
| Auth      | GitHub and Google OAuth; the app signs ES256 JWTs that Convex verifies (`convex/auth.config.ts`) |

Both free tiers are enough to launch: Deno Deploy gives 1M requests and 20 GB of egress a month; Convex gives 1M function
calls, 0.5 GB of database and 1 GB of file storage.

## Develop

Needs Node 24+, pnpm (or just `vp`), and Deno 2 for the production server.

```bash
vp install
vp run convex          # local Convex backend; no account needed. Leave it running.
vp run keys            # once: signing keys in .env.local, public key in Convex
vp dev                 # http://localhost:5173
```

Locally there's a password-free **dev login** on `/login`. OAuth providers light up when their keys are set (see
`.env.example`).

```bash
vp check               # oxfmt, oxlint and type-aware checks
vp test                # Vitest, including Convex functions via convex-test
vp build               # production bundles in build/
vp run start           # serve build/ with Deno, like production
vp run ci              # everything CI does: typegen, check, test, build
```

CI runs locally, not on GitHub. `vp install` sets up git hooks: pre-commit runs `vp staged` (format and lint the staged
files) and pre-push runs `vp run ci`, so nothing broken gets pushed. If hooks aren't active in a fresh clone, run
`vp hooks enable`.

## Deploy

1. **Convex.** `npx convex login`, then `npx convex deploy` to create the production deployment. Run
   `APP_URL=https://slopper.day node scripts/convex-keys.ts --prod --print` to give Convex the public key and print the
   private key for the app.
2. **Deno Deploy.** Create an app at [console.deno.com](https://console.deno.com) from this repository. Build settings
   come from `deno.json` (install with `deno install`, build with React Router, run `deploy/main.ts`). Set the
   environment variables from `.env.example`: `APP_URL=https://slopper.day`, `CONVEX_URL` (your `*.convex.cloud` URL),
   `SLOPPER_JWT_ISSUER`, `SLOPPER_JWT_PRIVATE_KEY`, `SLOPPER_SECRET_KEY`, `ADMIN_USERNAMES` and the OAuth keys.
3. **Domain.** Add `slopper.day` to the Deno Deploy app.

### OAuth apps

| Provider | Where                                                            | Callback URL                                 | Notes                                                                                                                          |
| -------- | ---------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| GitHub   | Settings → Developer settings → OAuth Apps                       | `https://slopper.day/auth/github/callback`   | Sign in.                                                                                                                       |
| Google   | Google Cloud console → Credentials → OAuth client (Web)          | `https://slopper.day/auth/google/callback`   | Sign in. Scopes: openid, email, profile.                                                                                       |
| X        | developer.x.com → app → User authentication (OAuth 2.0, Web App) | `https://slopper.day/auth/x/callback`        | Auto-post. Scopes: tweet.read, tweet.write, users.read, offline.access. **Pay per use:** a post with a link costs about $0.20. |
| LinkedIn | linkedin.com/developers → app → Products                         | `https://slopper.day/auth/linkedin/callback` | Add "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn". Tokens last 60 days.                                 |
| Bluesky  | Nothing to register                                              |                                              | People connect with an app password.                                                                                           |

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
