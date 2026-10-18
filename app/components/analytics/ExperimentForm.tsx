import { Form } from "react-router";
import { eventLabel } from "~/lib/insights";

export interface ExperimentFormValues {
  key: string;
  name: string;
  hypothesis: string;
  flagKey: string;
  goalEvent: string;
  goalPath: string;
}

/**
 * Sets up an experiment, or changes one that hasn't started. `flags` are the
 * flags it can split people by: those with variants.
 */
export function ExperimentForm({
  values,
  flags,
  eventNames,
  editing = false,
}: {
  values: Partial<ExperimentFormValues>;
  flags: readonly { key: string; name: string }[];
  eventNames: readonly string[];
  editing?: boolean;
}) {
  return (
    <Form method="post" className="panel mt-12 grid gap-5" aria-labelledby="experiment-form-title">
      <h2 id="experiment-form-title" className="title-2">
        {editing ? "Change it" : "A new experiment"}
      </h2>
      <input type="hidden" name="intent" value="save" />
      {flags.length === 0 ? (
        <p className="text-muted">An experiment splits people with a flag that has variants. Make one first.</p>
      ) : (
        <>
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
                placeholder="wall-order"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="field-label">Name</span>
              <input name="name" defaultValue={values.name} required className="input" placeholder="Newest first" />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="field-label">What you expect</span>
            <textarea
              name="hypothesis"
              defaultValue={values.hypothesis}
              className="input min-h-16"
              placeholder="Showing the newest slops first gets more of them upvoted."
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="field-label">Flag</span>
            <select name="flagKey" defaultValue={values.flagKey} required className="input font-mono">
              {flags.map((flag) => (
                <option key={flag.key} value={flag.key}>
                  {flag.key} ({flag.name})
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="field-label">Goal</span>
              <span className="field-hint">The event that counts as it working.</span>
              <input
                name="goalEvent"
                defaultValue={values.goalEvent}
                required
                list="experiment-goal-events"
                className="input font-mono"
              />
              <datalist id="experiment-goal-events">
                {eventNames.map((name) => (
                  <option key={name} value={name}>
                    {eventLabel(name)}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="field-label">On the page (optional)</span>
              <span className="field-hint">Only count the goal on this path.</span>
              <input name="goalPath" defaultValue={values.goalPath} className="input font-mono" placeholder="/new" />
            </label>
          </div>
          <button type="submit" className="btn btn-slop justify-self-start">
            {editing ? "Save" : "Set it up"}
          </button>
        </>
      )}
    </Form>
  );
}

/** The form's fields as an experiment; `get` returns "" for a field that isn't there. */
export function parseExperimentForm(get: (name: string) => string) {
  const path = get("goalPath").trim();
  return {
    key: get("key").trim().toLowerCase(),
    name: get("name").trim().slice(0, 100),
    hypothesis: get("hypothesis").trim().slice(0, 1000),
    flagKey: get("flagKey").trim(),
    goal: {
      event: get("goalEvent").trim().slice(0, 200),
      filters: path ? [{ key: "path", operator: "equals" as const, value: path }] : [],
    },
  };
}
