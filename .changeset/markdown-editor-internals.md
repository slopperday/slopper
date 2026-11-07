---
slopper:
  type: feat
---

# Markdown fields are canvist editors

MarkdownEditor upgrades the server-rendered textarea to a lazily loaded @canvist/web editor (348 KB gzipped WebAssembly, only on pages with a field), keeping the hidden textarea as the form value. Exports are tidied of needless escapes (tidyEscapes), single new lines become hard breaks on the way in (toEditorMarkdown), and a field the editor can't show faithfully (readsTheSame) stays a textarea. The CSP adds 'wasm-unsafe-eval'. The promo video's fallback link to its raw file is gone.
