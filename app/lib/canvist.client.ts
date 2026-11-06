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
} from "@canvist/web/full";

/**
 * Markdown reveal: the Markdown of the formatting at the caret shows around
 * it and can be edited (`markdownReveal` in canvist's full module).
 */
const markdownReveal = { name: "markdownReveal", commands: [], nodes: [], queries: [] } as const;

/**
 * The canvist editor behind Slopper's Markdown fields, loaded only in the
 * browser and only once a field needs it. Every extension writes Markdown;
 * underline is left out because Markdown can't keep it. Markdown reveal
 * shows the syntax of the formatting at the caret, so it stays editable.
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
  markdownReveal,
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
