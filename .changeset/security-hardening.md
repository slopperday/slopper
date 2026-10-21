---
slopper:
  type: fix
---

# Security hardening: ingest ceilings, rate limits and fail-safe checks

Round one — the attacks the audits proved, closed:

- Analytics ingestion (`/a/e`, `/a/r`) is public, so it now has ceilings: events per minute and per UTC day, per distinct id, merges into an account, and recording bytes and chunks (packages/analytics). A flood hits the ceiling — and the shared counter slows it down — instead of the deployment's storage and function budget; honest traffic never notices.
- Share-card URLs only render their canonical version: any other `?v=` is redirected to it (301), so made-up query strings can't fill the CDN or make the server draw. Drawing also reads a new, lighter `slops.card` query, and each address has an hourly ceiling.
- Anonymous routes that cost a Convex write per request are rate limited per address: OAuth starts (30/h), CLI polls (720/h), scheduled-launch claims (600/h, id-shaped first), unsubscribes (60/h), REST and MCP pre-limits (4800/h) before a bearer is resolved, and the MCP endpoint refuses requests without a token before parsing their body (draining it, so keep-alive connections survive). Anonymous wall searches get the API's 120/h too: each one costs an embedding model call.
- Editing a slop is limited (30/day) and clears its content-check verdict the moment the checked content changes: a re-check that errors leaves it held for a moderator, the way a launch that fails its check is, instead of showing a stale "ok" over new text.
- Public queries are bounded: a day's race caps at 500 items, goal standings at 2,000 goals × 2,000 slops, a slop's page at 500 updates/comments/launches.
- Upvotes notify their owner once an hour per slop, not once per toggle; avatar copies from providers time out after 10s and refuse oversized bodies.

Round two — deeper audits, all fixed:

- A check verdict now carries a fingerprint of the content it judged (`moderation.applyCheck`): a check that was in flight while the slop was edited lands on nothing, so swapped-in text can never ride an "ok" out to the maker's social accounts.
- Scheduled releases the app server never finished (it was down, or `tellApp` gave up) are retried by a 15-minute cron backstop, so a launch can't sit live and unchecked.
- Deleting a slop no longer refunds its voters' five votes for the day.
- `money.add` and `goals.create` validate their numbers Convex-side (NaN, negatives and degenerate goals are refused, not stored).
- `safeReturnTo` rejects control characters: a tab after the slash turned `/\t//evil.com` into a redirect off the site after login.
- The CSP is nonce-based — no more `unsafe-inline` scripts — and static files get `nosniff` and the referrer policy at the edge too. The two preference cookies are `Secure` on HTTPS.
- Every outbound fetch to an address a person typed (a Bluesky PDS, self-hosted PostHog, the Solana RPC, a slop's website) rides the SSRF-pinned transport, which checks the address inside the DNS lookup it connects with: DNS rebinding can't slip a private address past.
- `media.url` (any media id → its URL) is server-only; API tokens expire after a year; uploads nothing ever attaches to are swept after two weeks; the OAuth-state/session/rate-limit sweeper reschedules itself while there's more, so floods can't outgrow it; and the fflate copy satori pulls in is pinned past its CVE.

Pinned so they can't quietly come back: `tests/security.test.ts` (every public Convex function names an auth gate; the CSP keeps its nonce; the one raw-HTML sink stays the sanitizer; anonymous Convex-costing routes keep a ceiling; ingest caps stay caps), `tests/replay-sandbox.test.ts` (the replay iframe never allows scripts), and `e2e/security.spec.ts` (the exploits themselves, replayed every CI run).
