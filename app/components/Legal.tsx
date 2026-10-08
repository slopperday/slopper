/** Plain-language policy pages (privacy, terms): a title, a date and short sections. */

export interface LegalSection {
  title: string;
  body: readonly string[];
}

export function LegalPage({
  intro,
  title,
  updated,
  sections,
}: {
  /** One line under the title, before the date. */
  intro: string;
  title: string;
  /** ISO date the text last changed. */
  updated: string;
  sections: readonly LegalSection[];
}) {
  return (
    <section className="mx-auto max-w-3xl px-4 pt-14 pb-6">
      <h1 className="title-1">{title}</h1>
      <p className="mt-4 text-muted">
        {intro} Last updated <time dateTime={updated}>{updated}</time>.
      </p>
      <div className="mt-12 grid gap-10">
        {sections.map((section) => (
          <section key={section.title} aria-labelledby={slug(section.title)}>
            <h2 id={slug(section.title)} className="font-display text-[1.75rem] leading-tight font-extrabold">
              {section.title}
            </h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="mt-3 max-w-[65ch]">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
