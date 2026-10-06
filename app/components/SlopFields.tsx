import { CATEGORIES, LIMITS, type SlopLink } from "~/lib/model";
import { LinkFields } from "./LinkFields";
import { ScreenshotPicker } from "./ScreenshotPicker";

export type FieldErrors = Record<string, string>;

export interface SlopFormValues {
  name: string;
  tagline: string;
  description: string;
  category: string;
  nsfw: boolean;
  links: SlopLink[];
  screenshots: string[];
  madeWith: string[];
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
export function SlopFields({ values, errors }: { values: Partial<SlopFormValues>; errors: FieldErrors }) {
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

      <Field
        label="Where to try it"
        error={errors.links}
        hint="Websites are fastest. TestFlight and Android beta links count as a launch too."
      >
        <LinkFields initial={values.links ?? []} max={LIMITS.links} />
      </Field>

      <Field
        label="Screenshots"
        error={errors.screenshots}
        hint="The first one is the cover. Big images are shrunk before upload."
      >
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
        <Field id="madeWith" label="Made with" hint="Comma separated: Claude Code, Flutter, Solana…">
          <input
            id="madeWith"
            name="madeWith"
            className="input"
            defaultValue={(values.madeWith ?? []).join(", ")}
            placeholder="Claude Code, Vite"
          />
        </Field>
      </div>

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

      <label className="flex items-start gap-3 rounded-xl border-2 border-ink bg-card p-4">
        <input
          type="checkbox"
          name="nsfw"
          defaultChecked={values.nsfw ?? false}
          className="mt-1 size-5 accent-[var(--hot)]"
        />
        <span>
          <span className="font-bold">Not safe for work</span>
          <span className="block text-sm text-muted">
            Adult themes, gore, strong language. NSFW slops are blurred and kept out of feeds unless people opt in. Porn
            and illegal content aren't allowed at all.
          </span>
        </span>
      </label>
    </div>
  );
}
