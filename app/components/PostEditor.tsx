import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Link } from "react-router";
import { useAnalytics } from "@slopperday/analytics/react";
import { fromEditorDoc, parseWhen, type Person, personOn, toEditorDoc, writeWhen } from "~/lib/dynamicText";
import { NETWORK_LABELS, SOCIAL_PROVIDERS, type SocialProvider } from "~/lib/networks";
import type { PostEditor as Editor } from "~/lib/postEditor.client";

export interface PostEditorHandle {
  focus(): void;
}

interface Suggestion {
  query: string;
  left: number;
  top: number;
}

/**
 * The Studio's post field. It starts as a plain textarea (what the server
 * renders, and what works without JavaScript), then becomes a canvist editor
 * where `@` tags someone from the address book and "Only on…" keeps words
 * for some networks. Either way the value is the stored words
 * (`{{@key}}`, `{{only …}}…{{/only}}`, app/lib/dynamicText.ts).
 */
export const PostEditor = forwardRef<
  PostEditorHandle,
  {
    id: string;
    label: string;
    value: string;
    onChange: (text: string) => void;
    people: readonly Person[];
    /** The networks the post goes to: what "Only on…" offers. */
    networks: readonly SocialProvider[];
    placeholder?: string;
    maxLength?: number;
    className?: string;
    onPasteFiles?: (files: File[]) => void;
  }
>(function PostEditor(
  { id, label, value, onChange, people, networks, placeholder, maxLength, className = "", onPasteFiles },
  ref,
) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  // The words the editor last reported, so a change from outside (a template, the assistant) can be told apart.
  const emitted = useRef(value);
  const latest = useRef({ value, onChange, people, onPasteFiles });
  latest.current = { value, onChange, people, onPasteFiles };
  const analytics = useAnalytics();
  const [ready, setReady] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [picked, setPicked] = useState(0);
  const [selection, setSelection] = useState<{ range: boolean; when: SocialProvider[] }>({ range: false, when: [] });

  useImperativeHandle(ref, () => ({
    focus: () => (editor.current ? editor.current.focus() : textarea.current?.focus()),
  }));

  const matches = suggestion
    ? people
        .filter((person) =>
          [person.name, person.key].some((name) => name.toLowerCase().includes(suggestion.query.toLowerCase())),
        )
        .slice(0, 6)
    : [];
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const pickedRef = useRef(picked);
  pickedRef.current = picked;

  function tag(person: Person) {
    editor.current?.commands.insertMention({ id: person.key, label: person.name });
    setSuggestion(null);
    editor.current?.focus();
  }
  const tagRef = useRef(tag);
  tagRef.current = tag;

  useEffect(() => {
    const field = textarea.current;
    const element = host.current;
    if (!field || !element) return;
    let destroyed = false;
    let cleanup = () => {};
    (async () => {
      const { createPostEditor } = await import("~/lib/postEditor.client");
      if (destroyed) return;
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const made = await createPostEditor(element, {
        doc: toEditorDoc(latest.current.value, latest.current.people),
        label,
        placeholder,
        dark,
      });
      if (destroyed) return made.destroy();
      const hadFocus = document.activeElement === field;
      editor.current = made;
      emitted.current = latest.current.value;

      const sync = () => {
        const next = fromEditorDoc(made.toJson() as never).replace(/\n+$/, "");
        if (next !== emitted.current) {
          emitted.current = next;
          latest.current.onChange(next);
        }
        const found = made.query.mentionSuggestion();
        const caret = made.caretRect();
        if (found && caret) {
          const rect = made.toClientRect(caret);
          const box = element.getBoundingClientRect();
          setSuggestion({ query: found.query, left: rect.left - box.left, top: rect.bottom - box.top + 6 });
        } else setSuggestion(null);
        const when = made.query.conditionalWhen() ?? "";
        setSelection({ range: !caret, when: parseWhen(when) });
      };
      const unsubscribe = made.subscribe(sync);
      // While suggestions are open, the arrows, Enter and Escape pick from them instead of editing.
      const keys = (event: KeyboardEvent) => {
        const list = matchesRef.current;
        if (!made.query.mentionSuggestion()) return;
        if (event.key === "Escape") made.commands.dismissMentionSuggestion();
        else if (list.length === 0) return;
        else if (event.key === "ArrowDown") setPicked((pickedRef.current + 1) % list.length);
        else if (event.key === "ArrowUp") setPicked((pickedRef.current - 1 + list.length) % list.length);
        else if (event.key === "Enter" || event.key === "Tab") tagRef.current(list[pickedRef.current] ?? list[0]);
        else return;
        event.preventDefault();
        event.stopPropagation();
      };
      const paste = (event: ClipboardEvent) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length === 0 || !latest.current.onPasteFiles) return;
        event.preventDefault();
        event.stopPropagation();
        latest.current.onPasteFiles(files);
      };
      element.addEventListener("keydown", keys, true);
      element.addEventListener("paste", paste, true);
      cleanup = () => {
        unsubscribe();
        element.removeEventListener("keydown", keys, true);
        element.removeEventListener("paste", paste, true);
        editor.current = null;
        made.destroy();
      };
      setReady(true);
      if (hadFocus) requestAnimationFrame(() => made.focus());
    })().catch((failure: unknown) => {
      // The textarea keeps working; tell the error log why the editor didn't.
      analytics?.captureException(failure);
    });
    return () => {
      destroyed = true;
      cleanup();
    };
  }, [label, placeholder, analytics]);

  // Words set from outside the editor (a template, the writing assistant, a saved post) replace its document.
  useEffect(() => {
    if (!editor.current || value === emitted.current) return;
    emitted.current = value;
    editor.current.setContent(toEditorDoc(value, people) as never);
  }, [value, people]);

  useEffect(() => setPicked(0), [suggestion?.query]);

  return (
    <div className="grid gap-2" data-post-editor={ready || undefined}>
      <textarea
        ref={textarea}
        id={ready ? undefined : id}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPaste={(event) => {
          const files = [...event.clipboardData.files];
          if (files.length === 0 || !onPasteFiles) return;
          event.preventDefault();
          onPasteFiles(files);
        }}
        maxLength={maxLength}
        hidden={ready}
        aria-hidden={ready || undefined}
        tabIndex={ready ? -1 : undefined}
      />
      {/* The field is taller than its words, as the textarea was: a press below them still starts writing. */}
      <div
        id={ready ? id : undefined}
        className={`relative cursor-text [&_canvas]:outline-none ${className}`}
        hidden={!ready}
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget && event.target !== host.current) return;
          event.preventDefault();
          editor.current?.focus();
        }}
      >
        <div ref={host} />
        {suggestion && (
          <div
            className="absolute z-20 w-64 rounded-xl border border-line bg-raised p-1 shadow-lg"
            style={{ left: suggestion.left, top: suggestion.top }}
          >
            {matches.length > 0 ? (
              <ul role="listbox" aria-label="People to tag">
                {matches.map((person, index) => (
                  <li key={person.key} role="option" aria-selected={index === picked}>
                    <button
                      type="button"
                      className={`grid w-full rounded-lg px-3 py-1.5 text-left text-sm ${index === picked ? "bg-sunk" : "hover:bg-sunk"}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => tag(person)}
                    >
                      <span className="font-bold">{person.name}</span>
                      <span className="text-xs text-muted">
                        {SOCIAL_PROVIDERS.filter((provider) => person.handles[provider]?.trim())
                          .map((provider) => `${NETWORK_LABELS[provider]} ${personOn(person, provider)}`)
                          .join(" · ") || "Their name, everywhere"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-2 text-sm text-muted">
                {people.length ? "No one by that name. " : "Tag people by adding them first. "}
                <Link to="/studio/settings#people" className="link">
                  People
                </Link>
              </p>
            )}
          </div>
        )}
      </div>
      {ready && networks.length > 1 && <OnlyOn editor={editor} networks={networks} selection={selection} />}
    </div>
  );
});

/**
 * "Only on…": words for some of the post's networks. Selected words become
 * theirs; with nothing selected, it writes new words for them at the caret.
 */
function OnlyOn({
  editor,
  networks,
  selection,
}: {
  editor: React.RefObject<Editor | null>;
  networks: readonly SocialProvider[];
  selection: { range: boolean; when: SocialProvider[] };
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<SocialProvider[]>([]);
  const [words, setWords] = useState("");

  function apply() {
    const made = editor.current;
    if (!made || chosen.length === 0) return;
    const when = writeWhen(chosen);
    if (selection.range) made.commands.setConditional({ when });
    else if (words.trim()) made.commands.insertConditional({ when, text: words });
    setOpen(false);
    setWords("");
    made.focus();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {selection.range && selection.when.length > 0 && (
        <span className="rounded-full bg-sunk px-2.5 py-1 text-muted">
          Only on {selection.when.map((provider) => NETWORK_LABELS[provider]).join(", ")}
        </span>
      )}
      <button
        type="button"
        className="btn btn-quiet btn-sm"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setChosen(selection.when);
          setOpen(!open);
        }}
      >
        {selection.range ? "Only on…" : "Add words for some networks"}
      </button>
      {selection.range && selection.when.length > 0 && (
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            editor.current?.commands.unsetConditional();
            editor.current?.focus();
          }}
        >
          For every network
        </button>
      )}
      {open && (
        <fieldset className="grid w-full gap-2 rounded-xl border border-line p-3">
          <legend className="px-1 font-bold">
            {selection.range ? "Only post the selected words on" : "Words only these networks get"}
          </legend>
          <div className="flex flex-wrap gap-3">
            {networks.map((provider) => (
              <label key={provider} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={chosen.includes(provider)}
                  onChange={(event) =>
                    setChosen(
                      event.target.checked ? [...chosen, provider] : chosen.filter((other) => other !== provider),
                    )
                  }
                />
                {NETWORK_LABELS[provider]}
              </label>
            ))}
          </div>
          {!selection.range && (
            <input
              className="input"
              aria-label="Words for those networks"
              placeholder="Link in bio"
              value={words}
              onChange={(event) => setWords(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  apply();
                }
              }}
            />
          )}
          <button
            type="button"
            className="btn btn-ink btn-sm justify-self-start"
            disabled={chosen.length === 0 || (!selection.range && !words.trim())}
            onClick={apply}
          >
            {selection.range ? "Keep them for these networks" : "Add"}
          </button>
        </fieldset>
      )}
    </div>
  );
}
