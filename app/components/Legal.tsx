/** Plain-language policy pages (privacy, terms): a title, a date and short sections. */

export interface LegalSection {
  title: string;
  body: readonly string[];
}

export function LegalPage({
  eyebrow,
  title,
  updated,
  sections,
}: {
  eyebrow: string;
  title: string;
  /** ISO date the text last changed. */
  updated: string;
  sections: readonly LegalSection[];
}) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="font-wide mt-2 text-4xl font-black sm:text-5xl">{title}</h1>
      <p className="mt-3 font-mono text-xs text-muted">
        Last updated <time dateTime={updated}>{updated}</time>
      </p>
      <div className="mt-10 grid gap-8">
        {sections.map((section) => (
          <section key={section.title} aria-labelledby={slug(section.title)}>
            <h2 id={slug(section.title)} className="text-xl font-black">
              {section.title}
            </h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="mt-2 text-muted">
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
