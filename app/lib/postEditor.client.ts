import { conditional, createEditor, hardBreak, history, mention } from "@canvist/web/full";
import type { EditorNode } from "./dynamicText";

/**
 * The canvist editor behind the Studio's post field, loaded only in the
 * browser once the composer mounts. Posts are plain text, so it has no
 * formatting: paragraphs, line breaks, people as `mention` chips and words
 * for some networks as `conditional` marks (./dynamicText.ts).
 */
const EXTENSIONS = [hardBreak, history, mention, conditional] as const;

export type PostEditor = Awaited<ReturnType<typeof createPostEditor>>;

export function createPostEditor(
  element: HTMLElement,
  options: { doc: EditorNode; label: string; placeholder?: string; dark: boolean },
) {
  return createEditor(element, {
    extensions: EXTENSIONS,
    content: options.doc as never,
    label: options.label,
    placeholder: options.placeholder,
    theme: {
      scheme: options.dark ? "dark" : "light",
      bodyFamily: '"Schibsted Grotesk Variable", "Schibsted Grotesk", system-ui, sans-serif',
      size: 19,
      lineHeight: 1.625,
    },
  });
}
