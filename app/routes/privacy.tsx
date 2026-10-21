import type { Route } from "./+types/privacy";
import { CONTACT_EMAIL } from "~/lib/model";
import { seo } from "~/lib/seo";
import { AnalyticsChoice } from "~/components/AnalyticsChoice";
import { LegalPage, type LegalSection } from "~/components/Legal";

const SECTIONS: readonly LegalSection[] = [
  {
    title: "What we keep",
    body: [
      "Your account: a username, display name, avatar, bio, website and time zone. When you sign in with GitHub, Google, LinkedIn or Facebook we keep that account's id, so it signs you in again. When that account shares an email address it has verified, we keep it only to send your daily digest, which you can turn off in Settings or from any digest.",
      "What you post: slops, screenshots, updates, feedback, votes, pledges, goals and the money you log. Slops, updates, feedback and upvote counts are public. Downvotes and who pledged what stay private (only totals show), and your money ledger stays private unless you make it public.",
      "Connected accounts: if you connect LinkedIn or Bluesky for auto-posting, we keep the tokens those networks give us, encrypted, and use them only to post what you ask us to post.",
    ],
  },
  {
    title: "How Slopper is used",
    body: [
      "To see what works and what's broken, Slopper records how it's used: the pages you open, how long they stay open and how far down you scroll, the buttons and links you click, with their labels, and where on the page you clicked. Never what you type into a field.",
      "With each visit we note where you came from (the site that linked you and any utm tags on the link), your browser, operating system and kind of device, and your country, from Netlify's location lookup. Your IP address isn't kept.",
      "A cookie with a random id links one visit to the next. When you sign in, your earlier visits join your account, so we can see how people find Slopper and what they do once they're here. Launches, updates, votes, goals and pledges are recorded too (that you pledged, not how much).",
      "When something breaks, in your browser or on our server, we record the error, the page it happened on and when, so we can fix it. We also measure how fast pages load for you.",
      "Now and then a page may ask you one question. If you answer, we keep your answer, and anything you write, with your visit. Closing it is fine, and you won't be asked that question again.",
      "The same id decides which version you see when we try two versions of something, and we record which one you saw, to tell which works better. If you turn analytics off, you get the usual version.",
      "Visits are also recorded so we can play them back and see where people get stuck: what the pages looked like and how the mouse moved, scrolled and clicked. Whatever you type into a field shows as stars, and your own private pages (settings, API keys, notifications, your money) aren't recorded at all. Recordings are deleted after 30 days.",
      "It's all first-party: it stays in Slopper's own database, only Slopper's admins see it, and no analytics or advertising company gets any of it. We keep it for a year (recordings for 30 days). You can turn it off in this browser below, or in Settings.",
    ],
  },
  {
    title: "Cookies",
    body: [
      "Only the ones Slopper needs: your session, a short-lived one while you sign in, one that carries a message to the next page, one with your time zone so times show in it, and two for analytics, the random id above and one that remembers if you turned analytics off. No advertising or third-party cookies.",
    ],
  },
  {
    title: "Who else sees it",
    body: [
      "Convex stores Slopper's data, analytics included; Backblaze B2 stores screenshots and copies of profile pictures. Netlify runs the site. Slopper serves its own typefaces; the daily digest email loads them from Google Fonts, so your email app may ask Google for them.",
      "An AI model checks every screenshot as it's uploaded (with its file name), every launch, auto-posted update and promo video to keep Slopper safe for work. OpenRouter passes each check to DeepSeek (or another host of DeepSeek's model when DeepSeek is down), and videos to Google. They get the text, images and videos of what you post, nothing about your account.",
      "Resend sends the daily digest, so it gets your email address and the digest's contents.",
      "When you auto-post, the networks you connected get the post. We don't sell your data or share it with anyone else.",
    ],
  },
  {
    title: "Your choices",
    body: [
      "You can edit or delete any slop, update or feedback you posted, change your profile, revoke API tokens, disconnect social accounts and turn analytics off at any time. To delete your whole account, or what analytics has on you, email us and we'll remove it.",
    ],
  },
  {
    title: "Questions",
    body: [`Email ${CONTACT_EMAIL}. If this policy changes, the date at the top changes with it.`],
  },
];

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Privacy", path: "/privacy" });

export default function Privacy() {
  return (
    <>
      <LegalPage intro="In plain words." title="Privacy" updated="2026-10-18" sections={SECTIONS} />
      <div className="mx-auto max-w-3xl px-4 pb-6">
        <AnalyticsChoice />
      </div>
    </>
  );
}
