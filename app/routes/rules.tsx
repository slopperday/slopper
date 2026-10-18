import type { Route } from "./+types/rules";
import { seo } from "~/lib/seo";

const RULES = [
  {
    title: "Ship something real",
    body: "Something people can try today: a site, a beta, a published app, a repo with a demo. Ideas and waitlists don't count.",
  },
  {
    title: "Keep it safe for work",
    body: "Things you'd show anyone. Every launch, screenshot, video and auto-post is checked. Sexual or hateful screenshots are refused, and launches with anything sexual, hateful or illegal wait for a moderator and never auto-post.",
  },
  {
    title: "No spam, malware or scams",
    body: "No phishing, rug pulls, credential harvesting or nasty downloads. Promoting your own stuff is the point. Deceiving people isn't.",
  },
  {
    title: "Be useful in feedback",
    body: "Help the maker. Be specific and generous: everything here is meant to be rough. Downvotes are private for a reason.",
  },
  {
    title: "Auto-posts are yours",
    body: "Auto-post speaks as you. You own what it says, and each network's rules apply.",
  },
];

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Rules", path: "/rules" });

export default function Rules() {
  return (
    <section className="mx-auto max-w-3xl px-4 pt-14">
      <h1 className="title-1">Rules</h1>
      <p className="lede mt-4">A short list. Break one and your slop comes off the wall.</p>
      <ol className="mt-12 divide-y divide-line border-y border-line">
        {RULES.map((rule, index) => (
          <li key={rule.title} className="grid grid-cols-[2.25rem_1fr] gap-x-4 py-6">
            <span className="font-display text-[2rem] leading-none font-black text-faint tabular-nums">
              {index + 1}
            </span>
            <div>
              <h2 className="font-display text-[1.75rem] leading-none font-extrabold">{rule.title}</h2>
              <p className="mt-2 max-w-[60ch]">{rule.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-10 text-muted">
        See something that breaks these? Use “Flag as inappropriate” on its page. Flagged slops stop auto-posting at
        once.
      </p>
    </section>
  );
}
