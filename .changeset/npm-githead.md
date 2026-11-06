---
cli:
  type: fix
---

# npm packages record their publishing commit again

The CLI and its skill are published with the npm CLI once more. The pnpm-based
publisher dropped the `gitHead` field from the registry record, so installs
pinned to the publishing commit (like the dotfiles skill sync) refused every
release after 0.1.8.
