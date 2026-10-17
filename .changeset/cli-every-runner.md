---
cli:
  type: docs
---

# Run the CLI with any package runner

The README and the skill show `npx -y`, `pnpm dlx`, `bunx`, `yarn dlx -q`, `deno run -A npm:` and a global install, why npx needs `-y` (it waits on "Ok to proceed?" in a terminal) and yarn `-q` (its install log lands on stdout), and `SLOPPER_TOKEN` for agents that shouldn't write a config file.
