---
slopper: user_feat
---

# CLI commands on the API page that agents can paste as they are

The API page's CLI command now uses `npx -y`, so an agent in a terminal doesn't stop at npx's install question, and names the other runners (pnpm, Bun, Yarn, Deno). A second command passes your token in `SLOPPER_TOKEN` without saving it anywhere. /llms.txt lists the same.
