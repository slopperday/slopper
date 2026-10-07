import { useState } from "react";
import { LINK_KINDS, type SlopLink } from "~/lib/model";
import { Icon } from "./Icon";

interface Row {
  key: number;
  kind: string;
  url: string;
}

const KIND_OPTIONS = Object.entries(LINK_KINDS).map(([value, info]) => ({
  value,
  label: info.label,
  placeholder: info.placeholder,
}));

/** Repeating "type + URL" rows for website, store and beta links. */
export function LinkFields({ initial, max }: { initial: readonly SlopLink[]; max: number }) {
  const [rows, setRows] = useState<Row[]>(() => {
    const start = initial.length > 0 ? initial : [{ kind: "website", url: "" }];
    return start.map((row, key) => ({ key, kind: row.kind, url: row.url }));
  });
  const [nextKey, setNextKey] = useState(rows.length);

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function add() {
    const used = new Set(rows.map((row) => row.kind));
    const kind = KIND_OPTIONS.find((option) => !used.has(option.value))?.value ?? "other";
    setRows((current) => [...current, { key: nextKey, kind, url: "" }]);
    setNextKey((key) => key + 1);
  }

  return (
    <div className="grid gap-2.5">
      {rows.map((row, index) => {
        const option = KIND_OPTIONS.find((kind) => kind.value === row.kind);
        return (
          <div key={row.key} className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_auto] gap-2">
            <select
              name="linkKind"
              className="input"
              aria-label={`Link ${index + 1} type`}
              value={row.kind}
              onChange={(event) => update(row.key, { kind: event.currentTarget.value })}
            >
              {KIND_OPTIONS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </select>
            <input
              name="linkUrl"
              type="url"
              inputMode="url"
              className="input"
              aria-label={`Link ${index + 1} address`}
              placeholder={option?.placeholder ?? "https://"}
              value={row.url}
              onChange={(event) => update(row.key, { url: event.currentTarget.value })}
            />
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              aria-label={`Remove link ${index + 1}`}
              disabled={rows.length === 1}
              onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))}
            >
              <Icon name="close" className="size-4" />
            </button>
          </div>
        );
      })}
      {rows.length < max && (
        <button type="button" className="btn btn-sm justify-self-start" onClick={add}>
          <Icon name="plus" className="size-4" /> Add a link
        </button>
      )}
    </div>
  );
}
