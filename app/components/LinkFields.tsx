import { useId, useState } from "react";
import { LINK_KINDS, type SlopLink } from "~/lib/model";
import { Icon } from "./Icon";

interface Row {
  key: number;
  kind: string;
  url: string;
  preview: boolean;
}

const KIND_OPTIONS = Object.entries(LINK_KINDS).map(([value, info]) => ({
  value,
  label: info.label,
  placeholder: info.placeholder,
}));

interface LinkFieldsProps {
  initial: readonly SlopLink[];
  max: number;
  /**
   * Links are extras (on an update): start with none, and any row can go.
   * Otherwise there's always at least one row, since a slop needs a link.
   */
  optional?: boolean;
  /** Offer a preview card per link, off until ticked. Sent as `linkPreview`, one per row. */
  previews?: boolean;
}

/** Repeating "type + URL" rows for website, store and beta links. */
export function LinkFields({ initial, max, optional = false, previews = false }: LinkFieldsProps) {
  const id = useId();
  const [rows, setRows] = useState<Row[]>(() => {
    const start = initial.length > 0 || optional ? initial : [{ kind: "website", url: "" }];
    return start.map((row, key) => ({ key, kind: row.kind, url: row.url, preview: false }));
  });
  const [nextKey, setNextKey] = useState(rows.length);

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function add() {
    const used = new Set(rows.map((row) => row.kind));
    const kind = KIND_OPTIONS.find((option) => !used.has(option.value))?.value ?? "other";
    setRows((current) => [...current, { key: nextKey, kind, url: "", preview: false }]);
    setNextKey((key) => key + 1);
  }

  return (
    <div className="grid gap-2.5">
      {rows.map((row, index) => {
        const option = KIND_OPTIONS.find((kind) => kind.value === row.kind);
        const previewId = `${id}-preview-${row.key}`;
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
              disabled={!optional && rows.length === 1}
              onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))}
            >
              <Icon name="close" className="size-4" />
            </button>
            {previews && (
              <div className="col-start-2 -mt-1 flex min-h-9 items-center gap-2 text-[0.9375rem]">
                {/* Unticked checkboxes send nothing, so a hidden field keeps one value per row. */}
                <input type="hidden" name="linkPreview" value={row.preview ? "on" : "off"} />
                <input
                  id={previewId}
                  type="checkbox"
                  className="size-4"
                  checked={row.preview}
                  onChange={(event) => update(row.key, { preview: event.currentTarget.checked })}
                />
                <label htmlFor={previewId} className="text-muted">
                  Show a preview card
                </label>
              </div>
            )}
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
