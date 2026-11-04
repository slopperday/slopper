# The studio: post once, as any brand, everywhere

`/studio` is a composer for social posts. Pick accounts (grouped by the brand each
speaks for), write once, add pictures or one video, and each network gets a copy
that fits it. Sent posts read their stats back for a month. Screenshots are in
`docs/studio/` (made by `STUDIO_SCREENSHOTS=1 vp exec playwright test e2e/studio.spec.ts`).
How to set up each network, step by step, is in [social-setup.md](social-setup.md).

| Network        | Connects with                                        | Takes                                | Stats                                     |
| -------------- | ---------------------------------------------------- | ------------------------------------ | ----------------------------------------- |
| X              | Slopper's app, or your own API keys                  | words, 4 pictures or a video         | views, likes, replies, reposts, bookmarks |
| LinkedIn       | Slopper's app (profile; Pages with `LINKEDIN_PAGES`) | words, pictures or a video           | none: partners only                       |
| Bluesky        | app password                                         | words, 4 pictures                    | likes, replies, reposts (public, free)    |
| Threads        | Threads login (`THREADS_CLIENT_*`)                   | words, pictures or a video           | views, likes, replies, reposts, shares    |
| Facebook Pages | Facebook login, Pages you tick                       | words, link, pictures, video         | reactions, comments, shares               |
| Instagram      | comes with its linked Facebook Page                  | pictures, carousel, Reel, Story      | views, likes, comments, shares, saves     |
| TikTok         | TikTok login (`TIKTOK_CLIENT_*`)                     | a video                              | views, likes, comments, shares            |
| YouTube        | Google login, one channel each                       | a video (Short when vertical ≤3 min) | per video + channel analytics             |
| Mastodon       | an access token from your server                     | words, 4 pictures or a video         | favourites, replies, boosts               |
| Discord        | a channel webhook                                    | words, pictures or a video           | none                                      |
| Telegram       | your own bot                                         | words, pictures or a video           | none                                      |
| Reddit         | Reddit login (`REDDIT_CLIENT_*`), a subreddit each   | a link or text post                  | score, comments                           |

## Every feature, and where it came from

In November 2026 we studied 19 commercial tools (Buffer, Hootsuite, Later,
Sprout Social, Publer, Metricool, SocialBee, Typefully, Vista Social, Sendible,
Agorapulse, Planable, Loomly, Ayrshare, Pallyy, Hypefury, Post Bridge, Blotato)
and 8 open-source projects (Postiz, Mixpost, TryPost, CogSend, Socioboard,
Shoutify, Crosspost, Bluesky Crossposter). This is every feature the studio
took from them. The "Seen in" column names a few of the products that have it.

### Writing

| #   | Feature                                                                               | Seen in                      | Where                               |
| --- | ------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------- |
| 1   | Write once, post to many accounts on 8 networks                                       | all                          | `/studio`                           |
| 2   | A different version per network                                                       | Buffer, Postiz, Mixpost      | "Say it differently on one network" |
| 3   | Live preview per network, with "cut to fit" warnings                                  | Hootsuite, Planable, CogSend | Preview column                      |
| 4   | Character counts the network's way (X weights, Bluesky graphemes)                     | Mixpost, CogSend             | `app/lib/compose.ts`                |
| 5   | Warnings before sending when a network can't take the post                            | Postiz, Mixpost, Ayrshare    | `unsupportedReason`                 |
| 6   | Threads on X, Bluesky and Threads                                                     | Typefully, Buffer, Postiz    | Thread editor                       |
| 7   | Split long words into a thread to fit (`---` forces a split)                          | CogSend                      | "Split to fit"                      |
| 8   | First comment (X, Bluesky, Threads, Facebook, Instagram, LinkedIn)                    | Buffer, Later, Mixpost       | First comment field                 |
| 9   | Alt text on pictures (X, Bluesky, Instagram, Threads, LinkedIn)                       | Hootsuite, Postiz, CogSend   | Under each picture                  |
| 10  | Hashtag groups                                                                        | Buffer, Mixpost, SocialBee   | Snippets                            |
| 11  | Signatures, one adding itself to new posts                                            | Postiz, Publer               | Snippets                            |
| 12  | Templates                                                                             | Loomly, Mixpost              | Snippets                            |
| 13  | Variables: {date} {day} {time} {product} {link} {network}                             | Mixpost, Sendible            | `app/lib/variables.ts`              |
| 14  | Spintax, one variation per account                                                    | Publer                       | `{Hi                                | Hello}` |
| 15  | AI assistant: shorter, longer, rephrase, punchier, hashtags, thread, fit to a network | all suites                   | Assistant buttons                   |
| 16  | Brand voice the assistant follows                                                     | Typefully, Mixpost, Loomly   | Studio settings                     |
| 17  | Hashtag suggestions                                                                   | Hootsuite, Later, Metricool  | Assistant                           |
| 18  | Start a post from a product (its tagline, page and screenshots)                       | Agorapulse (repurposing)     | "Start from it"                     |
| 19  | Share any page to the studio (bookmarklet)                                            | Buffer, Vista (extensions)   | Studio settings                     |
| 20  | Private notes on a post                                                               | Buffer, Planable, Ayrshare   | More options                        |
| 21  | Tags, used by filters, analytics and UTM campaigns                                    | Postiz, Mixpost, TryPost     | More options                        |
| 22  | Drafts, edited later                                                                  | all                          | "Save draft"                        |
| 23  | Edit a scheduled post until it goes out                                               | all                          | Edit                                |
| 24  | Use a sent post again                                                                 | Buffer, Publer               | "Use again"                         |

### Media

| #   | Feature                                               | Seen in                    | Where                                     |
| --- | ----------------------------------------------------- | -------------------------- | ----------------------------------------- |
| 25  | Pictures, carousels, videos (Reels, Shorts, TikTok)   | all                        | Media picker                              |
| 26  | Big videos sent straight to storage (512 MB)          | Mixpost, CogSend           | `uploads.ts`                              |
| 27  | LinkedIn PDF document posts                           | Metricool, Hypefury        | PDF button                                |
| 28  | Pick a video's cover frame (Instagram, TikTok)        | Buffer, Agorapulse, Postiz | Cover slider                              |
| 29  | YouTube custom thumbnail from a frame                 | Postiz                     | "Use this frame as the YouTube thumbnail" |
| 30  | Instagram collaborators                               | Postiz, Later              | Network details                           |
| 31  | Instagram Stories                                     | Buffer, Later, Hootsuite   | Network details                           |
| 32  | Pictures converted to what networks take (JPEG, size) | Publer, CogSend            | In the browser                            |

### Scheduling

| #   | Feature                                                       | Seen in                       | Where                |
| --- | ------------------------------------------------------------- | ----------------------------- | -------------------- |
| 33  | Schedule for a date and time                                  | all                           | "Pick a time"        |
| 34  | Weekly queue of times; "Add to queue" takes the next free one | Buffer, Postiz, Mixpost       | Studio settings      |
| 35  | Best times to post, from your own results                     | Buffer, Later, Mixpost        | Chips under the time |
| 36  | Repeating posts                                               | Publer, Postiz, Ayrshare      | Repeat               |
| 37  | Space the accounts out (staggering)                           | Publer                        | More options         |
| 38  | Pause every scheduled post at once                            | Hootsuite                     | Studio settings      |
| 39  | Bulk scheduling from a CSV                                    | Hootsuite, Publer, Agorapulse | Studio settings      |
| 40  | Duplicate guard (same words, same account, same day)          | Ayrshare                      | Convex `create`      |
| 41  | Reposts by your other accounts (X, Bluesky, Threads)          | Publer, Typefully             | "Repost it with"     |
| 42  | Retry only what failed; uncertain sends never resent          | Mixpost, CogSend, Postiz      | Post page            |

### Calendar

| #   | Feature                                               | Seen in          | Where              |
| --- | ----------------------------------------------------- | ---------------- | ------------------ |
| 43  | Month, week and list views                            | all              | `/studio/calendar` |
| 44  | Drag to reschedule                                    | all              | Calendar           |
| 45  | Filters by network, status and tag                    | Buffer, Planable | Calendar           |
| 46  | Instagram grid planner                                | Later, Planable  | "Instagram grid"   |
| 47  | Calendar feed for Google, Apple and Outlook calendars | Sprout, Loomly   | Studio settings    |

### Working with others

| #   | Feature                                                               | Seen in                   | Where            |
| --- | --------------------------------------------------------------------- | ------------------------- | ---------------- |
| 48  | Preview link anyone can open (no account), lasting 14 days, revocable | Planable, Postiz, CogSend | Post page        |
| 49  | Approve or ask for changes on the preview link                        | Planable, Pallyy          | `/review/:token` |
| 50  | Activity log per post                                                 | Mixpost                   | Post page        |

### After it goes out

| #   | Feature                                                                  | Seen in                     | Where           |
| --- | ------------------------------------------------------------------------ | --------------------------- | --------------- |
| 51  | Per-account receipts with links                                          | all                         | Post page       |
| 52  | Read comments (Bluesky, Facebook, Instagram, Threads, YouTube)           | all suites (inbox)          | Post page       |
| 53  | Reply to comments, checked first (Bluesky, Facebook, Instagram, Threads) | all suites                  | Post page       |
| 54  | Saved replies                                                            | Buffer, Hootsuite           | Snippets        |
| 55  | Take a post down (X, Bluesky, Threads, Facebook, LinkedIn)               | Publer                      | Post page       |
| 56  | Auto-plug: reply once a post reaches N likes                             | Typefully, Hypefury, Postiz | More options    |
| 57  | Reconnect alerts when a token stops working                              | Postiz, Mixpost             | Composer banner |

### Analytics

| #   | Feature                                               | Seen in                | Where                       |
| --- | ----------------------------------------------------- | ---------------------- | --------------------------- |
| 58  | Stats per copy, read for a month                      | all                    | Post page                   |
| 59  | Totals by network and by account; top posts           | all                    | `/studio/analytics`         |
| 60  | Engagement by format (video, pictures, thread…)       | Buffer, Hootsuite      | Analytics                   |
| 61  | Hashtag analytics                                     | Publer, Metricool      | Analytics                   |
| 62  | Daily trend chart                                     | all                    | Analytics                   |
| 63  | Tracked short links with UTM tags, clicks per network | Buffer, Postiz, Loomly | "Track clicks", `/go/:code` |
| 64  | CSV export                                            | Metricool, Loomly      | "Download CSV"              |
| 65  | YouTube channel analytics                             | Metricool, Vista       | Analytics                   |

### Automation and agents

| #   | Feature                                                                                                                                      | Seen in                   | Where                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------- |
| 66  | RSS and Atom feeds to posts (at once or at the next queue time)                                                                              | Publer, Postiz, Metricool | Studio settings            |
| 67  | Signed webhooks for `post.published` and `post.failed`                                                                                       | Postiz, Mixpost, Ayrshare | Studio settings            |
| 68  | MCP and REST: `list_social_accounts`, `create_social_post`, `list_social_posts`, `get_social_post`, `edit_social_post`, `cancel_social_post` | Postiz, Buffer, Typefully | `/mcp`, `/api/v1/social/*` |
| 69  | Idempotency keys                                                                                                                             | Ayrshare                  | `create_social_post`       |
| 70  | CLI: `social accounts`, `social post`, `social posts`, `social status`, `social edit`, `social cancel`                                       | Postiz, Mixpost           | `@slopperday/cli`          |
| 71  | Agent skill section                                                                                                                          | Typefully, Post Bridge    | `packages/skill/SKILL.md`  |

### Left out, and why

- **Multi-step approvals and SSO:** the preview link covers sign-off by a client or teammate.
- **A full unified inbox (DMs, mentions, listening, sentiment, comment-to-DM):**
  needs read and messaging permissions networks grant only after review. Comments
  and replies are on each post's page.
- **Competitor benchmarking, social listening, ads in the calendar:** paid data
  APIs.
- **Link-in-bio pages:** each maker's Slopper profile already lists their slops.
- **Canva, stock libraries, a built-in editor, watermarks, AI images and video:**
  third-party contracts or heavy media processing. Pictures are resized and
  converted in the browser.
- **Mobile apps and a browser extension:** the site works on phones; the
  bookmarklet stands in for the extension.
- **Scheduled email reports, white-label reports:** the CSV export comes first.
- **Pinterest, Google Business and more networks:** each needs its own app and
  review. Add one to `app/lib/networks.ts` and give it an adapter.

## Posting without surprises

What we took from studying how the leading schedulers stay easy (November 2026):

- **One idea, many destinations.** Each network, or one account, can have its own
  words (`overrides`), and its own link, media and first comment (`variants`,
  same keys). An account's version wins over its network's, which wins over the
  shared one; "Use shared version" drops it. `app/lib/destinations.ts` resolves
  them for the composer, the server and the agents alike.
- **A checklist per destination.** `readiness()` lists what stands in the way:
  `block` (it can't go: no media for Instagram, a broken connection, the same
  words on two X accounts), `warn` (it'll be shortened) and `info` (links that
  aren't clickable, X's price). Each line in the composer has a Fix button that
  goes to the field. The server refuses to save a post with a `block`.
- **Times.** "Same time for all" or "Choose per account" (`times`, account id to
  time). Wall times are read in the person's profile time zone, which the
  composer names, across clock changes (`wallTime` in `app/lib/csv.ts`).
  Best-time suggestions per account are labelled estimates.
- **X rules and costs.** X forbids the same automated post from several
  accounts, so two X accounts with the same words (spintax aside) are refused.
  Each X destination says what X bills its developer app: about $0.015 a post,
  $0.20 with a link.
- **Account sets.** "Last used" and "Post as <product>" pick a set in one tap
  (`socialSettings.lastAccountIds`).
- **Ideas and autosave.** A draft needs no accounts. The composer keeps what
  you're writing in the browser and offers it back.
- **Uncertain sends.** A send lost mid-way is never resent on its own. Its row
  on the post's page asks to check the network: "It posted" (with the link) or
  "It didn't post: send again" (`social.resolveUncertain`; agents:
  `resolve_social_delivery`, `slopper social resolve`).
- **Connection health.** Settings → Accounts says whether each account is
  connected, expiring within a week, or needs reconnecting.
- **Previews** are approximations of each network's layout.

## How it fits together

- **Brands.** `accounts.brand` names who an account speaks for. The composer's
  "All" picks a brand on every network; "For <product>" picks the accounts that
  product posts as. Accounts connected through Facebook are grouped under their
  Page's name. New Pages, channels and TikToks start Off for launch auto-posts.
- **One post, many deliveries.** `socialPosts` holds what was written;
  `socialDeliveries` one row per account (`convex/social.ts`). The app server
  claims due rows (leased), sends with the network's adapter
  (`app/.server/social/{adapters,meta,tiktok,youtube}.ts`) and records the
  outcome. Uploads networks process first (Instagram and Threads containers,
  TikTok, X video) come back `processing`, and Convex calls back
  (`/api/social/:id`) until they're done. A send lost past its lease is marked
  uncertain, never resent: retrying could post twice. Retry only resends failures.
- **Scheduling.** Convex runs `tellApp` at `scheduledAt`; a cron backstop catches
  missed ones. Cancel works until then.
- **Safety.** Nothing is sent unless the content check says `ok` for the words,
  pictures and video. Videos over 20 MB are checked by three frames the browser
  takes from them (each checked as it's uploaded).
- **Videos** go from the browser straight to storage (presigned B2 PUT, or a
  Convex upload URL), up to 512 MB, so Netlify's 6 MB request cap doesn't apply.
  The B2 bucket needs a CORS rule allowing `PUT` from the site's origin.
- **Stats.** A cron calls `/api/social/metrics` every 30 minutes; rows are read
  hourly on day one, every 6 hours for a week, daily to a month. X bills every
  read, so X posts are read at most daily. "Refresh stats" reads one post now.

## Before turning each network on

These are platform gates, not code:

- **Meta (Facebook, Instagram, Threads):** App Review for `pages_manage_posts`,
  `instagram_content_publish`, `instagram_manage_insights`, `threads_content_publish`
  and Business Verification. Until then only people with a role on the app can connect.
  Instagram and Threads fetch media from its URL, so media must be on public
  storage (B2), and Instagram pictures must be JPEG (the composer converts them).
- **TikTok:** the Content Posting API needs an audit. Unaudited apps can only post
  privately ("Only me"). The composer follows TikTok's UX rules: it shows the
  creator, makes you choose the audience, offers comment/duet/stitch and branded
  content disclosure.
- **YouTube:** each upload takes 1 unit from a separate upload quota of 100 a
  day per project (Google's reference, November 2026); more needs Google's quota
  audit. The connect flow asks for `youtube.upload`, `youtube.readonly` and
  `yt-analytics.readonly`: sensitive scopes, so the consent screen needs Google's
  verification before others connect.
- **X:** posting through Slopper's app costs Slopper per post, so it stays off;
  makers connect their own developer app instead (Settings → Accounts).
- **LinkedIn:** Company Pages need the Community Management API (partner
  approval). Once approved, set `LINKEDIN_PAGES=true`: connecting asks for the
  organization scopes and adds each Page the person administers.
- **Reddit:** a "web app" at reddit.com/prefs/apps (`REDDIT_CLIENT_*`). Each
  subreddit is its own destination; the token refreshes itself. Many subreddits
  limit self-promotion.

## Known limits and next steps

- Downloads for upload-based networks (X, LinkedIn, TikTok, YouTube) read the
  whole video into memory and must finish inside the function's time limit. Move
  delivery for big videos to a Netlify background function (15 minutes).
- Bluesky video isn't supported yet.

Official references:

- https://docs.x.com/x-api/media/quickstart/media-upload-chunked
- https://developers.facebook.com/docs/instagram-platform/content-publishing
- https://developers.facebook.com/docs/threads/posts
- https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- https://developers.google.com/youtube/v3/guides/uploading_a_video
- https://developers.google.com/youtube/analytics/reference/reports/query
