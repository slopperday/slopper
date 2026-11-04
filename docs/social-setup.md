# Setting up each network

The same guide is on Settings → Accounts ("How to set up each network"), with
your site's address in the redirect URLs; it comes from `app/lib/setupGuides.ts`.
"Once, on the server" is for whoever runs Slopper: a developer app, its keys in
`monosecret.toml` (secrets in the 1Password item), then `vp run env:netlify`. A
network whose keys aren't set isn't offered. "To connect" is for everyone.

Redirect URLs below use https://slopper.day; use your own `APP_URL` elsewhere
(and `http://localhost:5173` for a development app).

## X

Your own X developer app (four keys per brand), or Slopper's app.

**Once, on the server**

1. Optional: for a shared Slopper app, create one at console.x.com with OAuth 2.0 on, type “Web App, Automated App or Bot”, callback `https://slopper.day/auth/x/callback`, and set X_CLIENT_ID and X_CLIENT_SECRET. X bills Slopper for every post through it, so it's off by default.

Variables: `X_CLIENT_ID`, `X_CLIENT_SECRET`.

**To connect**

1. Sign in to console.x.com as the brand's X account and create a project and app.
2. In the app's User authentication settings, turn on OAuth 1.0a with “Read and write” permission.
3. Under Keys and tokens, copy the API Key and API Key Secret, then generate the Access Token and Access Token Secret (after setting the permission, or they'll be read-only).
4. Add API credits and a spending limit under Billing: X charges your app per post.
5. In Slopper: Settings → Accounts → “X · use your own API credentials”, paste the four values. Repeat for each brand.

- X bills about $0.015 per post and $0.20 per post with a link (X's price list, November 2026).
- X forbids the same automated post from several accounts: Slopper refuses it, so give each X account its own words or {spintax|variations}.

## LinkedIn

Sign in with LinkedIn (personal profile; Company Pages once LinkedIn approves your app).

**Once, on the server**

1. At linkedin.com/developers, create an app linked to your company's LinkedIn Page.
2. Under Products, add “Sign In with LinkedIn using OpenID Connect” and “Share on LinkedIn”.
3. Under Auth, add the redirect URL `https://slopper.day/auth/linkedin/callback`, then copy the Client ID and Primary Client Secret into LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.
4. To post as Company Pages: request the “Community Management API” product. Once LinkedIn approves it, set LINKEDIN_PAGES=true; reconnecting then adds every Page you administer as its own account.

Variables: `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_PAGES`.

**To connect**

1. Settings → Accounts → Connect LinkedIn, and approve.
2. With Pages turned on, each Page you're an admin of appears as its own account, grouped under its name.

- LinkedIn connections last 60 days: Slopper flags them before they expire, and reconnecting keeps your settings.
- LinkedIn shares post stats only with approved partners, so they don't show in Slopper.

## Bluesky

An app password (no developer app needed).

**To connect**

1. In Bluesky: Settings → Privacy and security → App passwords → Add App Password, named “Slopper”. Leave direct messages off.
2. Settings → Accounts → Bluesky: your handle and the app password. Self-hosted? Add your PDS address too.

- Never use your real password. Revoke the app password in Bluesky to disconnect it everywhere.

## Threads

Sign in with Threads.

**Once, on the server**

1. At developers.facebook.com, create an app with the “Access the Threads API” use case.
2. Add the permissions threads_basic, threads_content_publish, threads_manage_insights, threads_read_replies, threads_manage_replies and threads_delete.
3. In the use case's settings, add the redirect callback `https://slopper.day/auth/threads/callback`, plus uninstall and delete callbacks on your site.
4. Copy the Threads app ID and secret into THREADS_CLIENT_ID and THREADS_CLIENT_SECRET.
5. Until Meta's app review: add each Threads account as a tester under App roles, and accept the invite in Threads (Settings → Account → Website permissions → Invites).

Variables: `THREADS_CLIENT_ID`, `THREADS_CLIENT_SECRET`.

**To connect**

1. Settings → Accounts → Connect Threads, and approve.

- Threads fetches pictures and video from their address, so media must be on public storage (B2).

## Facebook

Sign in with Facebook, ticking the Pages to post as.

**Once, on the server**

1. At developers.facebook.com, create a Business app and add Facebook Login for Business.
2. Add the valid OAuth redirect URI `https://slopper.day/auth/facebook/callback` (the same one Facebook sign-in uses).
3. Request pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_engagement, pages_read_user_content and business_management, plus the Instagram permissions below.
4. FACEBOOK_CLIENT_ID and FACEBOOK_CLIENT_SECRET are the App ID and App secret.
5. Before anyone outside your team can connect: complete Business Verification and App Review. Until then, people with a role on the app can.

Variables: `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`.

**To connect**

1. Settings → Accounts → Connect Facebook & Instagram. In Facebook's window, tick every Page you want to post as.
2. Each Page becomes its own account, grouped under its name, and starts Off for launch auto-posts.

- Page tokens from a long-lived login don't expire, but changing your Facebook password ends them: reconnect then.

## Instagram

Comes with its Facebook Page.

**Once, on the server**

1. In the same Meta app, add instagram_basic, instagram_content_publish, instagram_manage_insights and instagram_manage_comments.

Variables: `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`.

**To connect**

1. Make the Instagram account a Business or Creator account (Instagram → Settings → Account type and tools).
2. Link it to a Facebook Page (the Page's Settings → Linked accounts → Instagram).
3. Connect Facebook & Instagram in Slopper: the linked Instagram account comes with its Page.

- Every Instagram post needs a picture or video. Pictures go as JPEG; Reels run 3 seconds to 15 minutes.
- Instagram fetches media from its address, so it must be on public storage (B2).

## TikTok

Sign in with TikTok.

**Once, on the server**

1. At developers.tiktok.com, create an app and add the Login Kit and Content Posting API products, with Direct Post turned on.
2. Add the scopes user.info.basic, video.publish, video.upload and video.list, and the redirect URI `https://slopper.day/auth/tiktok/callback`.
3. Fill in the app's website, terms and privacy links, then submit it for review.
4. TIKTOK_CLIENT_ID is the Client key; TIKTOK_CLIENT_SECRET the Client secret.

Variables: `TIKTOK_CLIENT_ID`, `TIKTOK_CLIENT_SECRET`.

**To connect**

1. Settings → Accounts → Connect TikTok, and approve. Connect each TikTok account the same way.
2. When posting, choose who can see it: TikTok requires you to pick each time.

- Until TikTok audits the app, every post is private (“Only me”) and only accounts added as target users in the sandbox can connect.

## YouTube

Sign in with Google, choosing a channel.

**Once, on the server**

1. In console.cloud.google.com, in the project behind Google sign-in, enable the YouTube Data API v3 and the YouTube Analytics API.
2. On the OAuth consent screen, add the scopes youtube.upload, youtube.readonly and yt-analytics.readonly. While it's in testing, add yourself as a test user.
3. Use the existing Web OAuth client (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) with `https://slopper.day/auth/google/callback` as an authorized redirect URI.
4. Publish the consent screen and complete Google's verification of those scopes before others connect: in testing, connections end after 7 days.

Variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

**To connect**

1. Settings → Accounts → Connect YouTube, and pick the channel. A brand account is its own channel: connect it the same way.

- Google allows 100 uploads a day per project by default (a separate quota from other calls; November 2026). More needs Google's quota audit.

## Mastodon

An access token from your own server.

**To connect**

1. On your Mastodon server: Preferences → Development → New application, named “Slopper”.
2. Give it read:accounts, read:statuses, write:statuses and write:media, then save.
3. Open the application and copy “Your access token”.
4. Settings → Accounts → Mastodon: your server's address and the token.

- Delete the application on your server to disconnect it everywhere.

## Discord

A channel webhook.

**To connect**

1. In Discord: Server Settings → Integrations → Webhooks → New Webhook, and pick the channel (#announcements, say).
2. Copy Webhook URL, then paste it in Settings → Accounts → Discord. One webhook per channel.

- Webhooks can post and take posts down, but Discord shares no stats with them.

## Telegram

Your own bot.

**To connect**

1. In Telegram, message @BotFather, send /newbot and follow its steps. Copy the token it gives you.
2. Add the bot to your channel or group as an administrator allowed to post messages.
3. Settings → Accounts → Telegram: the bot token and the channel's @handle (or a group's chat id).

- Telegram shares view counts only with channel admins in the app, not with bots.

## Reddit

Sign in with Reddit, then add the subreddits to post into.

**Once, on the server**

1. At reddit.com/prefs/apps, create an app of type “web app” with the redirect URI `https://slopper.day/auth/reddit/callback`.
2. Copy the client id (under the app's name) and secret into REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.

Variables: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`.

**To connect**

1. Settings → Accounts → Connect Reddit, and approve. It starts by posting to your own profile.
2. Under the Reddit account, add each subreddit it should post into. Each becomes its own destination.

- Read each subreddit's rules first: many limit self-promotion, and Reddit removes posts (and bans accounts) that break them.
