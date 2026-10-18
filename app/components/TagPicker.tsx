import { useEffect, useId, useMemo, useState } from "react";
import { LIMITS } from "~/lib/model";
import {
  cleanTags,
  exactTag,
  matchTags,
  TAG_KINDS,
  type TagKind,
  tagKey,
  tagKind,
  type TagOption,
  tagOptions,
} from "~/lib/tags";
import { Icon } from "./Icon";

/** How long typing has to pause before a tag that matches exactly is picked by itself. */
const PICK_AFTER_MS = 600;
/** Suggestions per kind before anything's typed, and in all once something is. */
const PER_KIND = 6;
const MATCHES = 12;

/** A "Made with" tag, coloured by its kind. */
export function MadeWithTag({ name, kind = tagKind(name) }: { name: string; kind?: TagKind }) {
  return (
    <span className={`tag tag-kind tag-kind-${kind}`} title={TAG_KINDS.find((k) => k.id === kind)?.label}>
      {name}
    </span>
  );
}

/**
 * "Made with": a search box over the tags we know (models, harnesses,
 * frameworks, platforms) and the ones people use most. Typing a tag's name
 * picks it once typing pauses, a suggestion picks it on click, and Enter or a
 * comma adds whatever's typed as a new tag. Each picked tag is its own
 * `madeWith` input, and the box is one too, so text left in it (or typed
 * before JavaScript loads, commas and all) is still sent.
 */
export function TagPicker({
  id,
  initial,
  counted,
}: {
  id: string;
  initial: readonly string[];
  /** Tags people have used and how often (convex/tags.ts `popular`). */
  counted: readonly { name: string; uses: number }[];
}) {
  const options = useMemo(() => tagOptions(counted), [counted]);
  const [picked, setPicked] = useState<string[]>(() => cleanTags(initial));
  const [typed, setTyped] = useState("");
  const [active, setActive] = useState(0);
  /** A tag taken back into the box with Backspace, which shouldn't jump straight back out. */
  const [held, setHeld] = useState<string | null>(null);
  const listId = useId();
  const full = picked.length >= LIMITS.madeWith;

  function pick(names: readonly string[]) {
    setPicked((current) => cleanTags([...current, ...names]));
    setTyped("");
    setActive(0);
    setHeld(null);
  }

  // A tag typed out in full goes in by itself once typing pauses.
  useEffect(() => {
    const exact = exactTag(options, typed, picked);
    if (!exact || full || typed === held) return;
    const timer = setTimeout(() => pick([exact.name]), PICK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [typed, options, picked, full, held]);

  const matches = typed.trim() ? matchTags(options, typed, picked).slice(0, MATCHES) : [];
  const typedIsNew = typed.trim() !== "" && !options.some((option) => tagKey(option.name) === tagKey(typed));

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      if (!typed.trim()) {
        if (event.key === ",") event.preventDefault();
        return;
      }
      event.preventDefault();
      const exact = options.find((option) => tagKey(option.name) === tagKey(typed));
      pick([exact?.name ?? matches[active]?.name ?? typed]);
    } else if (event.key === "ArrowDown" && matches.length > 0) {
      event.preventDefault();
      setActive((index) => (index + 1) % matches.length);
    } else if (event.key === "ArrowUp" && matches.length > 0) {
      event.preventDefault();
      setActive((index) => (index - 1 + matches.length) % matches.length);
    } else if (event.key === "Backspace" && !typed && picked.length > 0) {
      // Takes the last tag back into the box, to fix or drop.
      event.preventDefault();
      setTyped(picked[picked.length - 1]);
      setHeld(picked[picked.length - 1]);
      setPicked((current) => current.slice(0, -1));
    } else if (event.key === "Escape" && typed) {
      setTyped("");
    }
  }

  const suggestions = typed.trim() ? null : suggestionsByKind(options, picked);

  return (
    <div className="grid gap-3">
      <div className="input flex min-h-12 flex-wrap items-center gap-1.5 py-1.5 focus-within:outline-2">
        {picked.map((name) => (
          <span key={name} className={`tag tag-kind tag-kind-${tagKind(name)} gap-1 pr-1`}>
            <input type="hidden" name="madeWith" value={name} />
            {name}
            <button
              type="button"
              className="grid size-5 place-items-center rounded opacity-70 hover:opacity-100"
              aria-label={`Remove ${name}`}
              onClick={() => setPicked((current) => current.filter((other) => other !== name))}
            >
              <Icon name="close" className="size-3.5" />
            </button>
          </span>
        ))}
        <input
          id={id}
          name="madeWith"
          className="min-w-[10rem] flex-1 bg-transparent py-1 outline-none"
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          maxLength={LIMITS.madeWithLength}
          disabled={full && !typed}
          placeholder={
            full
              ? `That's ${LIMITS.madeWith}, the most`
              : picked.length
                ? "Add another…"
                : "Opus 5.5, Claude Code, Vite…"
          }
          value={typed}
          onChange={(event) => {
            const value = event.currentTarget.value;
            // A pasted or typed list: everything before the last comma becomes tags.
            if (value.includes(",")) {
              const parts = value.split(",");
              pick(parts.slice(0, -1));
              setTyped(parts[parts.length - 1].trimStart());
              return;
            }
            setTyped(value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="grid gap-2">
        {matches.length > 0 && (
          <div id={listId} role="listbox" aria-label="Matching tags" className="flex flex-wrap gap-1.5">
            {matches.map((option, index) => (
              <Suggestion
                key={option.name}
                id={`${listId}-${index}`}
                option={option}
                listed
                active={index === active}
                disabled={full}
                onPick={() => pick([option.name])}
              />
            ))}
          </div>
        )}
        {typedIsNew && !full && (
          <div>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => pick([typed])}>
              <Icon name="plus" className="size-4" />
              Add “{typed.trim()}”
            </button>
          </div>
        )}
        {suggestions?.map(({ kind, label, options: row }) => (
          <div key={kind} className="flex flex-wrap items-center gap-1.5">
            <span className="w-full text-[0.8125rem] font-bold text-muted sm:w-24">{label}</span>
            {row.map((option) => (
              <Suggestion key={option.name} option={option} disabled={full} onPick={() => pick([option.name])} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Suggestion({
  id,
  option,
  listed = false,
  active = false,
  disabled,
  onPick,
}: {
  id?: string;
  option: TagOption;
  /** One of the matches the box's combobox points at. */
  listed?: boolean;
  active?: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      role={listed ? "option" : undefined}
      aria-selected={listed ? active : undefined}
      aria-label={`Add ${option.name}`}
      disabled={disabled}
      className={`tag tag-kind tag-kind-${option.kind} tag-suggestion${active ? " is-active" : ""}`}
      // Keeps focus in the box, so picking several in a row doesn't need a click back.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
    >
      {option.name}
      {option.uses > 0 && <span className="font-normal opacity-70">{option.uses}</span>}
    </button>
  );
}

/** Before anything's typed: the most used models, harnesses, then everything else. */
function suggestionsByKind(options: readonly TagOption[], picked: readonly string[]) {
  const open = matchTags(options, "", picked);
  const rows: { kind: string; label: string; options: TagOption[] }[] = [];
  for (const kind of ["model", "harness"] as const) {
    rows.push({
      kind,
      label: TAG_KINDS.find((k) => k.id === kind)?.plural ?? kind,
      options: open.filter((option) => option.kind === kind).slice(0, PER_KIND),
    });
  }
  rows.push({
    kind: "more",
    label: "Built on",
    options: open.filter((option) => option.kind !== "model" && option.kind !== "harness").slice(0, PER_KIND * 2),
  });
  return rows.filter((row) => row.options.length > 0);
}
