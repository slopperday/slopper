import type { Route } from "./+types/rules";
import { seo } from "~/lib/seo";

const RULES = [
  {
    title: "Ship something real",
    body: "A slop is a working thing someone can try today: a website, a TestFlight or Android beta, a published app, a repo with a demo. Ideas and waitlists don't count.",
  },
  {
    title: "Tag NSFW, or don't post it",
    body: "Adult themes, gore and strong language need the NSFW tag. Those slops are blurred and kept out of feeds unless people opt in. Pornography, sexual content involving minors, and anything illegal are never allowed and get removed.",
  },
  {
    title: "No spam, malware or scams",
    body: "No phishing, rug pulls, credential harvesting, or links that download something nasty. Promoting your own stuff is the point. Deceiving people isn't.",
  },
  {
    title: "Be useful in feedback",
    body: "Feedback should help the maker. Be specific and generous; everything here is supposed to be rough. Downvotes are private for a reason.",
  },
  {
    title: "Auto-posts are yours",
    body: "Auto-post speaks as you. You're responsible for what it says, and for following each network's rules.",
  },
];

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Rules", path: "/rules" });

export default function Rules() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <p className="eyebrow">Short list</p>
      <h1 className="font-wide mt-2 text-4xl font-black sm:text-5xl">Rules</h1>
      <ol className="mt-10 grid gap-4">
        {RULES.map((rule, index) => (
          <li key={rule.title} className="stuck flex gap-5 p-5">
            <span className="font-wide text-4xl leading-none font-black text-slop-deep">{index + 1}</span>
            <div>
              <h2 className="text-lg font-black">{rule.title}</h2>
              <p className="mt-1 text-muted">{rule.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-10 text-sm text-muted">
        See something that breaks these? Use “Report this slop” on its page. Moderators can hide anything.
      </p>
    </section>
  );
}
