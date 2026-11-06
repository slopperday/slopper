import {
  blockquote,
  bold,
  bulletList,
  code,
  codeBlock,
  createEditor,
  hardBreak,
  heading,
  history,
  horizontalRule,
  italic,
  link,
  listItem,
  orderedList,
  strike,
  taskList,
  trailingNode,
} from "@canvist/web";

/**
 * The canvist editor behind Slopper's Markdown fields, loaded only in the
 * browser and only once a field needs it (its WebAssembly is ~900 KB).
 * Every extension writes Markdown; underline is left out because Markdown
 * can't keep it.
 */
const EXTENSIONS = [
  bold,
  italic,
  strike,
  code,
  link,
  heading,
  blockquote,
  codeBlock,
  hardBreak,
  horizontalRule,
  bulletList,
  orderedList,
  listItem,
  taskList,
  history,
  trailingNode,
] as const;

export type MarkdownEditor = Awaited<ReturnType<typeof createMarkdownEditor>>;

export function createMarkdownEditor(
  element: HTMLElement,
  options: { markdown: string; label: string; placeholder?: string; dark: boolean },
) {
  return createEditor(element, {
    extensions: EXTENSIONS,
    content: { format: "markdown", input: options.markdown },
    label: options.label,
    placeholder: options.placeholder,
    theme: {
      scheme: options.dark ? "dark" : "light",
      bodyFamily: '"Schibsted Grotesk Variable", "Schibsted Grotesk", system-ui, sans-serif',
      codeFamily: '"Atkinson Hyperlegible Mono Variable", ui-monospace, monospace',
      size: 16,
      lineHeight: 1.5,
    },
  });
}
