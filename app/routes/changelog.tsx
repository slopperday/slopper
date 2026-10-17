import type { Route } from "./+types/changelog";
import { RELEASES } from "~/.server/changelog";
import { EmptyState, Markdown } from "~/components/Shared";
import { Tiles } from "~/components/Tiles";
import { formatDate } from "~/lib/dates";
import { seo } from "~/lib/seo";

export function loader() {
  return { releases: RELEASES };
}

export const meta: Route.MetaFunction = ({ matches }) =>
  seo(matches, {
    title: "What's new",
    description: "Every Slopper release, newest first: what's new, what got fixed, and what changed.",
    path: "/changelog",
  });

export default function Changelog({ loaderData }: Route.ComponentProps) {
  const { releases } = loaderData;
  return (
    <section className="mx-auto max-w-3xl px-4 pt-14">
      <h1 className="title-1">What's new</h1>
      <p className="lede mt-4">Every release of Slopper, newest first.</p>
      {releases.length === 0 ? (
        <div className="mt-12">
          <EmptyState>Nothing released yet.</EmptyState>
        </div>
      ) : (
        <ol className="mt-12 divide-y divide-line border-y border-line">
          {releases.map((release) => (
            <li key={release.version} id={`v${release.version}`} className="scroll-mt-24 py-10">
              <h2 className="flex flex-wrap items-center gap-x-5 gap-y-3">
                <Tiles value={release.version} className="text-[2rem]" />
                <span className="sr-only">Version {release.version},</span>
                <time dateTime={release.date} className="caps">
                  {formatDate(release.date)}
                </time>
              </h2>
              {release.sections.map((section) => (
                <section key={section.title} className="mt-8">
                  <h3 className="caps">{section.title}</h3>
                  <ul className="mt-3 grid gap-6">
                    {section.notes.map((note) => (
                      <li key={note.summary}>
                        <h4 className="font-display text-[1.75rem] leading-none font-extrabold">{note.summary}</h4>
                        {note.html && <Markdown html={note.html} className="mt-2 max-w-[60ch]" />}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
