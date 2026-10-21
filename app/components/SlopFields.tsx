import { CATEGORIES, LIMITS, type SlopFeature, type SlopLink } from "~/lib/model";
import { FeatureFields } from "./FeatureFields";
import { LinkFields } from "./LinkFields";
import { type Publication, PublicationPicker } from "./PublicationPicker";
import { type Screenshot, ScreenshotPicker } from "./ScreenshotPicker";
import { TagPicker } from "./TagPicker";

export type FieldErrors = Record<string, string>;

export interface SlopFormValues {
  name: string;
  tagline: string;
  description: string;
  category: string;
  links: SlopLink[];
  screenshots: Screenshot[];
  publication: Publication | null;
  madeWith: string[];
  /** A YouTube, Loom or Vimeo link. */
  demo: string;
  features: SlopFeature[];
  audience: string;
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}

/** The fields shared by shipping a new slop and editing one. */
export function SlopFields({
  values,
  errors,
  tags = [],
}: {
  values: Partial<SlopFormValues>;
  errors: FieldErrors;
  /** "Made with" tags people use and how often, for suggestions (convex/tags.ts `popular`). */
  tags?: readonly { name: string; uses: number }[];
}) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-6 sm:grid-cols-[1fr_1.4fr]">
        <Field id="name" label="Name" error={errors.name}>
          <input
            id="name"
            name="name"
            className="input font-bold"
            required
            maxLength={LIMITS.nameLength}
            defaultValue={values.name ?? ""}
            placeholder="TiltMaze"
            autoComplete="off"
          />
        </Field>
        <Field id="tagline" label="Tagline" error={errors.tagline} hint="One line. What does it do?">
          <input
            id="tagline"
            name="tagline"
            className="input"
            required
            maxLength={LIMITS.taglineLength}
            defaultValue={values.tagline ?? ""}
            placeholder="A marble maze you play by tilting your phone"
            autoComplete="off"
          />
        </Field>
      </div>

      <Field label="Where to try it" error={errors.links} hint="TestFlight and Android beta links count too.">
        <LinkFields initial={values.links ?? []} max={LIMITS.links} />
      </Field>

      <Field
        label="Publication"
        error={errors.publication}
        hint={`Wrote a book, zine, guide or paper? Upload the PDF or EPUB (up to ${LIMITS.publicationBytes / 1024 / 1024} MB) and people read it here. With one, links are optional.`}
      >
        <PublicationPicker initial={values.publication ?? null} />
      </Field>

      <Field label="Screenshots" error={errors.screenshots} hint="The first is the cover. Big images get shrunk.">
        <ScreenshotPicker initial={values.screenshots ?? []} max={LIMITS.screenshots} />
      </Field>

      <div className="grid gap-6 sm:grid-cols-2">
        <Field id="category" label="Category" error={errors.category}>
          <select id="category" name="category" className="input" required defaultValue={values.category ?? ""}>
            <option value="" disabled>
              Pick one…
            </option>
            {CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.emoji} {category.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field
        id="madeWith"
        label="Made with"
        error={errors.madeWith}
        hint="The model, the harness and what it's built on. Pick one or type your own."
      >
        <TagPicker id="madeWith" initial={values.madeWith ?? []} counted={tags} />
      </Field>

      <Field
        id="description"
        label="Description"
        error={errors.description}
        hint="Markdown. What is it, why did you make it, what's next?"
      >
        <textarea
          id="description"
          name="description"
          className="input min-h-40"
          maxLength={LIMITS.descriptionLength}
          placeholder="Built in 3 hours with…"
          defaultValue={values.description ?? ""}
        />
      </Field>

      <ProductPageFields values={values} errors={errors} />
    </div>
  );
}

/**
 * The extras that turn a slop page into the product's home: a demo video,
 * what it does and who it's for. Optional, and folded away until there's
 * something in them so shipping stays quick.
 */
function ProductPageFields({ values, errors }: { values: Partial<SlopFormValues>; errors: FieldErrors }) {
  const filled = Boolean(values.demo || values.audience || values.features?.length);
  const failed = Boolean(errors.demo || errors.audience || errors.features);
  return (
    <details id="product-page" className="group scroll-mt-24 border-t border-line pt-5" open={filled || failed}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
        <span>
          <span className="block font-display text-[1.5rem] leading-none font-extrabold">Product page</span>
          <span className="mt-1 block text-[0.9375rem] text-muted">
            Optional. A demo video, what it does and who it's for.
          </span>
        </span>
        <span aria-hidden="true" className="font-display text-[1.75rem] text-muted group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="mt-6 grid gap-6">
        <Field
          id="demo"
          label="Demo video"
          error={errors.demo}
          hint="A YouTube video or Short, a Loom, or a Vimeo link. It plays on the slop page."
        >
          <input
            id="demo"
            name="demo"
            type="url"
            inputMode="url"
            className="input font-mono text-[0.9375rem]"
            defaultValue={values.demo ?? ""}
            placeholder="https://youtu.be/…"
            autoComplete="off"
          />
        </Field>
        <Field id="audience" label="Who it's for" error={errors.audience} hint="One line.">
          <input
            id="audience"
            name="audience"
            className="input"
            maxLength={LIMITS.audienceLength}
            defaultValue={values.audience ?? ""}
            placeholder="Anyone stuck on a bus with a phone and five minutes"
            autoComplete="off"
          />
        </Field>
        <Field
          label="What it does"
          error={errors.features}
          hint={`Up to ${LIMITS.features}: a short title, then one line.`}
        >
          <FeatureFields initial={values.features ?? []} />
        </Field>
      </div>
    </details>
  );
}
