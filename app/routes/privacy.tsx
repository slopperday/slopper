import type { Route } from "./+types/privacy";
import { CONTACT_EMAIL } from "~/lib/model";
import { seo } from "~/lib/seo";
import { LegalPage, type LegalSection } from "~/components/Legal";

const SECTIONS: readonly LegalSection[] = [
  {
    title: "What we keep",
    body: [
      "Your account: a username, display name, avatar, bio, website and time zone. When you sign in with GitHub or Google we keep their id for you, so you can sign in again. We read your email address only to suggest a username and never store it.",
      "What you post: slops, screenshots, updates, feedback, votes, pledges, goals and the money you log. Slops, updates, feedback and upvote counts are public. Downvotes and who pledged what stay private (only totals show), and your money ledger stays private unless you make it public.",
      "Connected accounts: if you connect X, LinkedIn or Bluesky for auto-posting, we keep the tokens those networks give us, encrypted, and use them only to post what you ask us to post.",
    ],
  },
  {
    title: "Cookies",
    body: [
      "Only the ones Slopper needs to work: your session, a short-lived one while you sign in, one that carries a message to the next page, and one with your time zone so “today” means your today. No advertising or tracking cookies, and no analytics.",
    ],
  },
  {
    title: "Who else sees it",
    body: [
      "Convex stores Slopper's data and screenshots. Deno Deploy runs the site. Google Fonts serves the typefaces, so your browser asks Google for them.",
      "DeepSeek checks every launch, its screenshots and auto-posted updates to keep Slopper safe for work. It gets the text and images of what you post, nothing about your account.",
      "When you auto-post, the networks you connected get the post. We don't sell your data or share it with anyone else.",
    ],
  },
  {
    title: "Your choices",
    body: [
      "You can edit or delete any slop, update or feedback you posted, change your profile, revoke API tokens and disconnect social accounts at any time. To delete your whole account, email us and we'll remove it.",
    ],
  },
  {
    title: "Questions",
    body: [`Email ${CONTACT_EMAIL}. If this policy changes, the date at the top changes with it.`],
  },
];

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Privacy", path: "/privacy" });

export default function Privacy() {
  return <LegalPage eyebrow="Plain words" title="Privacy" updated="2026-10-07" sections={SECTIONS} />;
}
