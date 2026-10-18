import { useState } from "react";
import { LIMITS, type SlopFeature } from "~/lib/model";
import { Icon } from "./Icon";

interface Row extends SlopFeature {
  key: number;
}

const HINTS: readonly SlopFeature[] = [
  { title: "Draw your own maze", body: "Sketch walls with a finger, then tilt to play it." },
  { title: "Share a level", body: "Every maze gets a link. Send it, race your friends." },
  { title: "No sign-up", body: "Open it and play. Nothing to install." },
];

/** Repeating "title + one line" rows for what a slop does. */
export function FeatureFields({ initial }: { initial: readonly SlopFeature[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    (initial.length > 0 ? initial : [{ title: "", body: "" }]).map((row, key) => ({ ...row, key })),
  );
  const [nextKey, setNextKey] = useState(rows.length);

  function update(key: number, patch: Partial<SlopFeature>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  return (
    <div className="grid gap-3">
      {rows.map((row, index) => {
        const hint = HINTS[index % HINTS.length];
        return (
          <div key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <input
                name="featureTitle"
                className="input font-bold"
                aria-label={`Feature ${index + 1} title`}
                maxLength={LIMITS.featureTitleLength}
                placeholder={hint.title}
                value={row.title}
                onChange={(event) => update(row.key, { title: event.currentTarget.value })}
              />
              <input
                name="featureBody"
                className="input"
                aria-label={`Feature ${index + 1} in one line`}
                maxLength={LIMITS.featureBodyLength}
                placeholder={hint.body}
                value={row.body}
                onChange={(event) => update(row.key, { body: event.currentTarget.value })}
              />
            </div>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              aria-label={`Remove feature ${index + 1}`}
              onClick={() =>
                rows.length === 1
                  ? update(row.key, { title: "", body: "" })
                  : setRows((current) => current.filter((other) => other.key !== row.key))
              }
            >
              <Icon name="close" className="size-4" />
            </button>
          </div>
        );
      })}
      {rows.length < LIMITS.features && (
        <button
          type="button"
          className="btn btn-sm justify-self-start"
          onClick={() => {
            setRows((current) => [...current, { key: nextKey, title: "", body: "" }]);
            setNextKey((key) => key + 1);
          }}
        >
          <Icon name="plus" className="size-4" /> Add a feature
        </button>
      )}
    </div>
  );
}
