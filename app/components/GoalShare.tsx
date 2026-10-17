import { shareIntents } from "~/lib/compose";
import { CopyButton } from "./Shared";

/**
 * Asks people to say their goal out loud. Fresh goals get the full pitch
 * above the grid; once the first slop is out it shrinks to a row of links.
 */
export function GoalShare({ text, url, fresh }: { text: string; url: string; fresh: boolean }) {
  const intents = shareIntents(text, url);
  const targets = [
    { href: intents.x, label: "X" },
    { href: intents.bluesky, label: "Bluesky" },
    { href: intents.linkedin, label: "LinkedIn" },
    { href: intents.threads, label: "Threads" },
  ];
  return (
    <section aria-labelledby="goal-share-title" className={fresh ? "panel p-6 sm:p-8" : ""}>
      <h2 id="goal-share-title" className={fresh ? "title-2" : "caps"}>
        Share your goal
      </h2>
      {fresh && <p className="lede mt-3">Say it out loud and you're likelier to see it through. Then throw day one.</p>}
      <blockquote className="mt-5 max-w-2xl border-l-2 border-line-strong pl-4 text-muted">
        {text} <span className="break-all">{url}</span>
      </blockquote>
      <div className="mt-5 flex flex-wrap gap-2">
        {targets.map((target) => (
          <a key={target.label} href={target.href} target="_blank" rel="noopener" className="btn btn-sm">
            {target.label}
          </a>
        ))}
        <div>
          <CopyButton value={`${text} ${url}`} label="Copy" />
        </div>
      </div>
    </section>
  );
}
