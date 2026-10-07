import { Link } from "react-router";
import type { Route } from "./+types/terms";
import { CONTACT_EMAIL } from "~/lib/model";
import { seo } from "~/lib/seo";
import { LegalPage, type LegalSection } from "~/components/Legal";

const SECTIONS: readonly LegalSection[] = [
  {
    title: "Using Slopper",
    body: [
      "You need to be at least 13, and old enough to agree to these terms where you live. Keep your account to yourself; you're responsible for what's posted from it, including by an agent with your API token.",
    ],
  },
  {
    title: "What you post",
    body: [
      "Your slops stay yours. By posting, you let Slopper show them, link to them and include them in feeds, the daily race and share cards, for as long as they're up. Only post things you have the right to share.",
      "Follow the rules. Every launch, screenshot and auto-posted update gets an automated content check; anything that fails it, or that people flag, can be blurred, held or removed by moderators, and accounts that keep breaking the rules can be closed.",
    ],
  },
  {
    title: "Auto-posting",
    body: [
      "Auto-post speaks as you on the networks you connect. You're responsible for those posts and for following each network's rules. Nothing is auto-posted until it passes the content check.",
    ],
  },
  {
    title: "Pledges",
    body: [
      "“Take my money” pledges are a signal of interest, not a payment, a purchase or an investment. No money moves, and nobody owes anybody anything because of a pledge.",
    ],
  },
  {
    title: "No guarantees",
    body: [
      "Slopper is provided as it is, while we build it. We can change it, pause it or stop it, and we're not liable for losses from using it, as far as the law allows. Slops are made by the people who post them, not by us; try them at your own risk.",
    ],
  },
  {
    title: "Changes and contact",
    body: [
      `If these terms change, the date at the top changes with it, and using Slopper after that means you accept them. Questions: ${CONTACT_EMAIL}.`,
    ],
  },
];

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Terms", path: "/terms" });

export default function Terms() {
  return (
    <>
      <LegalPage eyebrow="Plain words" title="Terms" updated="2026-10-07" sections={SECTIONS} />
      <p className="mx-auto max-w-3xl px-4 text-sm text-muted">
        See also the{" "}
        <Link to="/rules" className="underline">
          rules
        </Link>{" "}
        and the{" "}
        <Link to="/privacy" className="underline">
          privacy policy
        </Link>
        .
      </p>
    </>
  );
}
