# Roadmap

What's built is in the README. These come next, roughly in order.

## Money and pledges

- **Collect pledges for real.** Today "Take my money" pledges are non-binding signals. Next, a maker connects a Solana
  wallet and backers pay in USDC with Solana Pay, straight to the maker (no custody). Stripe Connect is the card option.
  Keep the language to backing and pre-orders: selling "investments" to the public makes it a securities offering.
- **More traction sources.** Stripe, Solana wallets, Google Analytics and PostHog are in. Next: RevenueCat, Lemon
  Squeezy, Polar and Plausible, each one client in `app/.server/integrations/`.

## Slopcessful by milestones

Winning slop of the day is one way to go slopcessful. The others are milestones that integrations verify, never ones a
maker types in:

- **1,000 users**, counted from real signups: a connection to the product's auth provider, or a signed signup webhook.
- **$1,000 of revenue**, in total, from the verified revenue connections above.

Each sets `slopcessfulAt` with a note saying what was passed (the daily crown already does this). Slopcessful keeps its
own badge, separate from slop of the day.

## Promo videos

- A Remotion composition per launch (vertical, square, landscape) built from the slop's name, tagline, screenshots and
  goal day. Preview it on the slop page with `@remotion/player`; render in the browser with `@remotion/web-renderer`
  (no server cost), or on a render server later.
- DeepSeek V4.1 Flash (through OpenRouter, JSON mode) writes the script from the description. Remotion is free for individuals and
  companies up to three people.

## More networks

- **Threads, Instagram (Reels), TikTok, YouTube Shorts.** Each needs an app review or audit before it can post publicly,
  so start the reviews early. Until then, share intents cover them.
- Bluesky over atproto OAuth instead of app passwords.

## Product

- Follow people and launches; notify followers when they ship.
- Weekly digest email of slop of the day winners.
- Embeddable "slopped on Slopper" badges and a live goal grid widget for READMEs.
- Social cards: generated Open Graph images per launch.
