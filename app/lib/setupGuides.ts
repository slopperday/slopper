import type { SocialProvider } from "./networks";

/**
 * How to set up each network, shown on Settings → Accounts and mirrored in
 * docs/social-setup.md. `owner` is the one-time setup on the server
 * (a developer app and its keys in monosecret.toml); `you` is what each
 * person does to connect an account. Steps follow each platform's
 * developer console as of November 2026: names in those consoles change,
 * so the gist matters more than the exact button.
 */

export interface SetupGuide {
  network: SocialProvider;
  /** How an account connects. */
  method: string;
  /** One-time server setup, by whoever runs Slopper. Empty when there's none. */
  owner: string[];
  /** Environment variables the owner sets (monosecret.toml, then `vp run env:netlify`). */
  env: string[];
  /** What each person does on Settings → Accounts. */
  you: string[];
  /** Limits and rules worth knowing before relying on it. */
  notes: string[];
}

/** `{callback}` in a step becomes this network's redirect address, e.g. https://slopper.day/auth/reddit/callback. */
export const SETUP_GUIDES: readonly SetupGuide[] = [
  {
    network: "x",
    method: "Your own X developer app (four keys per brand), or Slopper's app",
    owner: [
      "Optional: for a shared Slopper app, create one at console.x.com with OAuth 2.0 on, type “Web App, Automated App or Bot”, callback {callback}, and set X_CLIENT_ID and X_CLIENT_SECRET. X bills Slopper for every post through it, so it's off by default.",
    ],
    env: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
    you: [
      "Sign in to console.x.com as the brand's X account and create a project and app.",
      "In the app's User authentication settings, turn on OAuth 1.0a with “Read and write” permission.",
      "Under Keys and tokens, copy the API Key and API Key Secret, then generate the Access Token and Access Token Secret (after setting the permission, or they'll be read-only).",
      "Add API credits and a spending limit under Billing: X charges your app per post.",
      "In Slopper: Settings → Accounts → “X · use your own API credentials”, paste the four values. Repeat for each brand.",
    ],
    notes: [
      "X bills about $0.015 per post and $0.20 per post with a link (X's price list, November 2026).",
      "X forbids the same automated post from several accounts: Slopper refuses it, so give each X account its own words or {spintax|variations}.",
    ],
  },
  {
    network: "linkedin",
    method: "Sign in with LinkedIn (personal profile; Company Pages once LinkedIn approves your app)",
    owner: [
      "At linkedin.com/developers, create an app linked to your company's LinkedIn Page.",
      "Under Products, add “Sign In with LinkedIn using OpenID Connect” and “Share on LinkedIn”.",
      "Under Auth, add the redirect URL {callback}, then copy the Client ID and Primary Client Secret into LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET.",
      "To post as Company Pages: request the “Community Management API” product. Once LinkedIn approves it, set LINKEDIN_PAGES=true; reconnecting then adds every Page you administer as its own account.",
    ],
    env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_PAGES"],
    you: [
      "Settings → Accounts → Connect LinkedIn, and approve.",
      "With Pages turned on, each Page you're an admin of appears as its own account, grouped under its name.",
    ],
    notes: [
      "LinkedIn connections last 60 days: Slopper flags them before they expire, and reconnecting keeps your settings.",
      "LinkedIn shares post stats only with approved partners, so they don't show in Slopper.",
    ],
  },
  {
    network: "bluesky",
    method: "An app password (no developer app needed)",
    owner: [],
    env: [],
    you: [
      "In Bluesky: Settings → Privacy and security → App passwords → Add App Password, named “Slopper”. Leave direct messages off.",
      "Settings → Accounts → Bluesky: your handle and the app password. Self-hosted? Add your PDS address too.",
    ],
    notes: ["Never use your real password. Revoke the app password in Bluesky to disconnect it everywhere."],
  },
  {
    network: "threads",
    method: "Sign in with Threads",
    owner: [
      "At developers.facebook.com, create an app with the “Access the Threads API” use case.",
      "Add the permissions threads_basic, threads_content_publish, threads_manage_insights, threads_read_replies, threads_manage_replies and threads_delete.",
      "In the use case's settings, add the redirect callback {callback}, plus uninstall and delete callbacks on your site.",
      "Copy the Threads app ID and secret into THREADS_CLIENT_ID and THREADS_CLIENT_SECRET.",
      "Until Meta's app review: add each Threads account as a tester under App roles, and accept the invite in Threads (Settings → Account → Website permissions → Invites).",
    ],
    env: ["THREADS_CLIENT_ID", "THREADS_CLIENT_SECRET"],
    you: ["Settings → Accounts → Connect Threads, and approve."],
    notes: ["Threads fetches pictures and video from their address, so media must be on public storage (B2)."],
  },
  {
    network: "facebook",
    method: "Sign in with Facebook, ticking the Pages to post as",
    owner: [
      "At developers.facebook.com, create a Business app and add Facebook Login for Business.",
      "Add the valid OAuth redirect URI {callback} (the same one Facebook sign-in uses).",
      "Request pages_show_list, pages_read_engagement, pages_manage_posts, pages_manage_engagement, pages_read_user_content and business_management, plus the Instagram permissions below.",
      "FACEBOOK_CLIENT_ID and FACEBOOK_CLIENT_SECRET are the App ID and App secret.",
      "Before anyone outside your team can connect: complete Business Verification and App Review. Until then, people with a role on the app can.",
    ],
    env: ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"],
    you: [
      "Settings → Accounts → Connect Facebook & Instagram. In Facebook's window, tick every Page you want to post as.",
      "Each Page becomes its own account, grouped under its name, and starts Off for launch auto-posts.",
    ],
    notes: [
      "Page tokens from a long-lived login don't expire, but changing your Facebook password ends them: reconnect then.",
    ],
  },
  {
    network: "instagram",
    method: "Comes with its Facebook Page",
    owner: [
      "In the same Meta app, add instagram_basic, instagram_content_publish, instagram_manage_insights and instagram_manage_comments.",
    ],
    env: ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"],
    you: [
      "Make the Instagram account a Business or Creator account (Instagram → Settings → Account type and tools).",
      "Link it to a Facebook Page (the Page's Settings → Linked accounts → Instagram).",
      "Connect Facebook & Instagram in Slopper: the linked Instagram account comes with its Page.",
    ],
    notes: [
      "Every Instagram post needs a picture or video. Pictures go as JPEG; Reels run 3 seconds to 15 minutes.",
      "Instagram fetches media from its address, so it must be on public storage (B2).",
    ],
  },
  {
    network: "tiktok",
    method: "Sign in with TikTok",
    owner: [
      "At developers.tiktok.com, create an app and add the Login Kit and Content Posting API products, with Direct Post turned on.",
      "Add the scopes user.info.basic, video.publish, video.upload and video.list, and the redirect URI {callback}.",
      "Fill in the app's website, terms and privacy links, then submit it for review.",
      "TIKTOK_CLIENT_ID is the Client key; TIKTOK_CLIENT_SECRET the Client secret.",
    ],
    env: ["TIKTOK_CLIENT_ID", "TIKTOK_CLIENT_SECRET"],
    you: [
      "Settings → Accounts → Connect TikTok, and approve. Connect each TikTok account the same way.",
      "When posting, choose who can see it: TikTok requires you to pick each time.",
    ],
    notes: [
      "Until TikTok audits the app, every post is private (“Only me”) and only accounts added as target users in the sandbox can connect.",
    ],
  },
  {
    network: "youtube",
    method: "Sign in with Google, choosing a channel",
    owner: [
      "In console.cloud.google.com, in the project behind Google sign-in, enable the YouTube Data API v3 and the YouTube Analytics API.",
      "On the OAuth consent screen, add the scopes youtube.upload, youtube.readonly and yt-analytics.readonly. While it's in testing, add yourself as a test user.",
      "Use the existing Web OAuth client (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) with {callback} as an authorized redirect URI.",
      "Publish the consent screen and complete Google's verification of those scopes before others connect: in testing, connections end after 7 days.",
    ],
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    you: [
      "Settings → Accounts → Connect YouTube, and pick the channel. A brand account is its own channel: connect it the same way.",
    ],
    notes: [
      "Google allows 100 uploads a day per project by default (a separate quota from other calls; November 2026). More needs Google's quota audit.",
    ],
  },
  {
    network: "mastodon",
    method: "An access token from your own server",
    owner: [],
    env: [],
    you: [
      "On your Mastodon server: Preferences → Development → New application, named “Slopper”.",
      "Give it read:accounts, read:statuses, write:statuses and write:media, then save.",
      "Open the application and copy “Your access token”.",
      "Settings → Accounts → Mastodon: your server's address and the token.",
    ],
    notes: ["Delete the application on your server to disconnect it everywhere."],
  },
  {
    network: "discord",
    method: "A channel webhook",
    owner: [],
    env: [],
    you: [
      "In Discord: Server Settings → Integrations → Webhooks → New Webhook, and pick the channel (#announcements, say).",
      "Copy Webhook URL, then paste it in Settings → Accounts → Discord. One webhook per channel.",
    ],
    notes: ["Webhooks can post and take posts down, but Discord shares no stats with them."],
  },
  {
    network: "telegram",
    method: "Your own bot",
    owner: [],
    env: [],
    you: [
      "In Telegram, message @BotFather, send /newbot and follow its steps. Copy the token it gives you.",
      "Add the bot to your channel or group as an administrator allowed to post messages.",
      "Settings → Accounts → Telegram: the bot token and the channel's @handle (or a group's chat id).",
    ],
    notes: ["Telegram shares view counts only with channel admins in the app, not with bots."],
  },
  {
    network: "reddit",
    method: "Sign in with Reddit, then add the subreddits to post into",
    owner: [
      "At reddit.com/prefs/apps, create an app of type “web app” with the redirect URI {callback}.",
      "Copy the client id (under the app's name) and secret into REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.",
    ],
    env: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"],
    you: [
      "Settings → Accounts → Connect Reddit, and approve. It starts by posting to your own profile.",
      "Under the Reddit account, add each subreddit it should post into. Each becomes its own destination.",
    ],
    notes: [
      "Read each subreddit's rules first: many limit self-promotion, and Reddit removes posts (and bans accounts) that break them.",
    ],
  },
];

export function setupGuide(network: SocialProvider): SetupGuide | undefined {
  return SETUP_GUIDES.find((guide) => guide.network === network);
}

/** The redirect address a network's developer app needs. Facebook and Instagram share one, as do YouTube and Google. */
export function callbackPath(network: SocialProvider): string {
  const provider = network === "instagram" ? "facebook" : network === "youtube" ? "google" : network;
  return `/auth/${provider}/callback`;
}
