import { useEffect, useRef, useState } from "react";
import { useAnalytics } from "@slopperday/analytics/react";

/**
 * A Markdown field. It starts as the plain textarea (that's what the server
 * renders, and what works without JavaScript), then becomes a canvist editor:
 * Markdown formats itself as you type (`**bold**`, `## heading`, `- list`),
 * Backspace straight after puts the Markdown back, and the textarea, hidden,
 * keeps the Markdown the form submits.
 *
 * It stays a textarea when canvist can't load, or when the field holds
 * something the editor would change (a table, say).
 */
export function MarkdownEditor({
  id,
  name,
  label,
  defaultValue = "",
  placeholder,
  maxLength,
  required,
  className = "",
}: {
  id: string;
  name: string;
  /** The accessible name, the same words as the field's `<label>`. */
  label: string;
  defaultValue?: string;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  /** Classes for the box: sizing such as `min-h-40`. */
  className?: string;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const analytics = useAnalytics();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [length, setLength] = useState(defaultValue.length);

  useEffect(() => {
    const field = textarea.current;
    const element = host.current;
    if (!field || !element) return;
    let destroyed = false;
    let cleanup = () => {};
    (async () => {
      // The editor, and the Markdown renderer its safety check uses, load only once a field mounts.
      const [{ createMarkdownEditor }, { readsTheSame, tidyEscapes, toEditorMarkdown }] = await Promise.all([
        import("~/lib/canvist.client"),
        import("~/lib/editorMarkdown"),
      ]);
      if (destroyed) return;
      const markdown = field.value;
      const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const editor = await createMarkdownEditor(element, {
        markdown: toEditorMarkdown(markdown),
        label,
        placeholder,
        dark,
      });
      if (destroyed) return editor.destroy();
      // Whatever was typed in the textarea while the editor loaded comes along.
      const current = field.value;
      if (current !== markdown) editor.setContent({ format: "markdown", input: toEditorMarkdown(current) });
      // Never lose words: if the editor would change how this reads, keep the textarea.
      if (current.trim() && !readsTheSame(current, tidyEscapes(editor.export("markdown")))) return editor.destroy();
      const hadFocus = document.activeElement === field;

      let last = current;
      const sync = () => {
        const next = tidyEscapes(editor.export("markdown")).replace(/\n+$/, "");
        if (next === last) return;
        last = next;
        field.value = next;
        setLength(next.length);
        setError(null);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const unsubscribe = editor.subscribe(sync);
      // The browser checks the hidden textarea; say what's wrong next to the editor instead.
      const invalid = (event: Event) => {
        event.preventDefault();
        setError(field.validationMessage || "Fill this in.");
        editor.focus();
      };
      const focus = () => editor.focus();
      const reset = () => queueMicrotask(() => editor.setContent({ format: "markdown", input: field.value }));
      field.addEventListener("invalid", invalid);
      field.addEventListener("focus", focus);
      field.form?.addEventListener("reset", reset);
      cleanup = () => {
        unsubscribe();
        field.removeEventListener("invalid", invalid);
        field.removeEventListener("focus", focus);
        field.form?.removeEventListener("reset", reset);
        editor.destroy();
      };
      setReady(true);
      if (hadFocus) requestAnimationFrame(() => editor.focus());
    })().catch((failure: unknown) => {
      // The textarea keeps working; tell the error log why the editor didn't.
      analytics?.captureException(failure);
    });
    return () => {
      destroyed = true;
      cleanup();
    };
  }, [label, placeholder, analytics]);

  const over = maxLength !== undefined && length > maxLength;
  return (
    <div className="markdown-editor" data-ready={ready || undefined}>
      <textarea
        ref={textarea}
        // Once the editor is up, its canvas carries the label, so the hidden textarea gives up the id.
        id={ready ? undefined : id}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        maxLength={ready ? undefined : maxLength}
        required={required}
        // Once the editor is up, the textarea only carries the value: out of sight and out of the tab order.
        hidden={ready}
        aria-hidden={ready || undefined}
        tabIndex={ready ? -1 : undefined}
        onInput={(event) => setLength(event.currentTarget.value.length)}
        className={`input ${className}`}
      />
      <div
        className={`input markdown-editor-box ${className}`}
        hidden={!ready}
        aria-invalid={error || over ? true : undefined}
        onClick={(event) => {
          // Clicks on the box's padding still reach the text.
          if (event.target === event.currentTarget) host.current?.querySelector<HTMLElement>("[role=textbox]")?.focus();
        }}
      >
        <div ref={host} />
      </div>
      {ready && (error || over) && (
        <p role="alert" className="mt-1.5 text-sm font-bold text-hot">
          {over ? `That's ${length - maxLength!} characters too long (${maxLength!.toLocaleString()} at most).` : error}
        </p>
      )}
    </div>
  );
}
