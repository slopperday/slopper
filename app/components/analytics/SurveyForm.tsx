import { Form } from "react-router";
import { SURVEY_KINDS } from "~/lib/surveyForm";

/** Sets up a survey, or changes one that hasn't started (app/lib/surveyForm.ts reads it). */
export function SurveyForm({ values = {}, editing = false }: { values?: Record<string, string>; editing?: boolean }) {
  return (
    <Form method="post" className="panel mt-12 grid gap-5" aria-labelledby="survey-form-title">
      <h2 id="survey-form-title" className="title-2">
        {editing ? "Change it" : "A new survey"}
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
            placeholder="wall-rating"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="field-label">Name</span>
          <span className="field-hint">Only admins see it.</span>
          <input name="name" defaultValue={values.name} className="input" placeholder="How the wall feels" />
        </label>
      </div>
      <label className="grid gap-1 text-sm">
        <span className="field-label">Question</span>
        <input
          name="question"
          defaultValue={values.question}
          required
          maxLength={200}
          className="input"
          placeholder="How easy was it to find something you liked?"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="field-label">They answer with</span>
        <select name="kind" defaultValue={values.kind ?? "rating"} className="input">
          {SURVEY_KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        <span className="field-label">Options (for one of a few options)</span>
        <span className="field-hint">One per line, two to six.</span>
        <textarea name="choices" defaultValue={values.choices} rows={4} className="input" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="field-label">Then ask (optional)</span>
        <span className="field-hint">An open question after their answer, like “What would make it better?”</span>
        <input name="followUp" defaultValue={values.followUp} maxLength={200} className="input" />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          <span className="field-label">On pages starting with</span>
          <input name="pathPrefix" defaultValue={values.pathPrefix ?? "/"} className="input font-mono" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="field-label">Ask</span>
          <select name="audience" defaultValue={values.audience ?? "anyone"} className="input">
            <option value="anyone">Anyone</option>
            <option value="signed-in">People signed in</option>
            <option value="visitors">Visitors not signed in</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="field-label">After this many seconds</span>
          <input
            name="delaySeconds"
            type="number"
            min={0}
            max={600}
            defaultValue={values.delaySeconds ?? "10"}
            className="input"
          />
        </label>
      </div>
      <button type="submit" className="btn btn-slop justify-self-start">
        {editing ? "Save" : "Set it up"}
      </button>
    </Form>
  );
}
