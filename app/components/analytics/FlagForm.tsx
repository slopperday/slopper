import type { ReactNode } from "react";
import { Form } from "react-router";
import { FLAG_PROPERTIES, FORM_CONDITIONS, FORM_FILTERS, OPERATORS } from "~/lib/flagForm";

/** Turns a flag on or off, through the page's own action (intent "toggle"). */
export function FlagSwitch({ flagKey, active }: { flagKey: string; active: boolean }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="toggle" />
      <input type="hidden" name="key" value={flagKey} />
      <input type="hidden" name="active" value={String(!active)} />
      <button
        type="submit"
        className={`btn btn-sm ${active ? "btn-slop" : "bg-raised"}`}
        aria-label={`${flagKey}: ${active ? "on, turn it off" : "off, turn it on"}`}
      >
        {active ? "On" : "Off"}
      </button>
    </Form>
  );
}

/**
 * Makes or changes a flag (app/lib/flagForm.ts reads it). `values` are a
 * saved flag's fields, from `flagFormValues`, when it's being changed.
 */
export function FlagForm({ values = {}, editing = false }: { values?: Record<string, string>; editing?: boolean }) {
  return (
    <Form method="post" className="panel mt-12 grid gap-5" aria-labelledby="flag-form-title">
      <h2 id="flag-form-title" className="title-2">
        {editing ? "Change it" : "A new flag"}
      </h2>
      <input type="hidden" name="intent" value="save" />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="field-label">Key</span>
          <input
            name="key"
            defaultValue={values.key}
            readOnly={editing}
            required
            pattern="[a-z][a-z0-9\-]*"
            className="input font-mono"
            placeholder="new-wall"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="field-label">Name</span>
          <input name="name" defaultValue={values.name} required className="input" placeholder="The new wall" />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="field-label">What it's for</span>
        <textarea name="description" defaultValue={values.description} className="input min-h-16" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="field-label">Variants (optional)</span>
        <span className="field-hint">
          One per line with its weight, like “control 50”. Leave it empty for a flag that's just on or off.
        </span>
        <textarea name="variants" defaultValue={values.variants} className="input min-h-16 font-mono" />
      </label>
      {Array.from({ length: FORM_CONDITIONS }, (_, group) => (
        <ConditionGroup key={group} group={group} open={group === 0 || Boolean(values[`c${group}_rollout`])}>
          {Array.from({ length: FORM_FILTERS }, (_, index) => {
            const name = `c${group}_f${index}`;
            return (
              <div key={index} className="grid gap-2 sm:grid-cols-3">
                <select
                  name={`${name}_key`}
                  defaultValue={values[`${name}_key`] ?? ""}
                  className="input"
                  aria-label={`Group ${group + 1}, filter ${index + 1}: property`}
                >
                  <option value="">Anyone</option>
                  {FLAG_PROPERTIES.map((property) => (
                    <option key={property} value={property}>
                      {property}
                    </option>
                  ))}
                </select>
                <select
                  name={`${name}_operator`}
                  defaultValue={values[`${name}_operator`] ?? "equals"}
                  className="input"
                  aria-label={`Group ${group + 1}, filter ${index + 1}: comparison`}
                >
                  {OPERATORS.map((operator) => (
                    <option key={operator.value} value={operator.value}>
                      {operator.label}
                    </option>
                  ))}
                </select>
                <input
                  name={`${name}_value`}
                  defaultValue={values[`${name}_value`]}
                  className="input"
                  aria-label={`Group ${group + 1}, filter ${index + 1}: value`}
                />
              </div>
            );
          })}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="field-label">Percent of them</span>
              <span className="field-hint">{group === 0 ? "0 to 100." : "Leave it empty to skip this group."}</span>
              <input
                name={`c${group}_rollout`}
                type="number"
                min={0}
                max={100}
                step="any"
                defaultValue={values[`c${group}_rollout`] ?? (group === 0 ? "100" : "")}
                className="input"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="field-label">Always this variant (optional)</span>
              <span className="field-hint">Otherwise they're split by weight.</span>
              <input
                name={`c${group}_variant`}
                defaultValue={values[`c${group}_variant`]}
                className="input font-mono"
              />
            </label>
          </div>
        </ConditionGroup>
      ))}
      <label className="grid gap-1 text-sm">
        <span className="field-label">Payloads (optional)</span>
        <span className="field-hint">
          JSON the code gets with the flag: one line for an on-or-off flag, or one per variant, like “test
          {' {"color":"red"}'}”.
        </span>
        <textarea name="payloads" defaultValue={values.payloads} className="input min-h-16 font-mono" />
      </label>
      <button type="submit" className="btn btn-slop justify-self-start">
        {editing ? "Save" : "Make the flag"}
      </button>
    </Form>
  );
}

/**
 * One group of people who get the flag. The first is always shown; the
 * others ("or") stay folded away until they're needed.
 */
function ConditionGroup({ group, open, children }: { group: number; open: boolean; children: ReactNode }) {
  const fields = (
    <fieldset className="grid gap-3 rounded-xl border border-line p-4">
      <legend className="px-1 text-sm font-bold">{group === 0 ? "Who gets it" : "Or these people"}</legend>
      {children}
    </fieldset>
  );
  if (group === 0) return fields;
  return (
    <details open={open} className="group">
      <summary className="cursor-pointer text-sm font-bold">Or another group of people</summary>
      <div className="mt-3">{fields}</div>
    </details>
  );
}
