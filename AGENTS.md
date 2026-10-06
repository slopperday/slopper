<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Slopper project notes

- **Run it:** `vp run convex` (local Convex, no account), `vp run keys` once, then `vp dev`. Validate with
  `vp run ci` (typegen, check, test, build).
- **CI is local only.** There are no GitHub Actions workflows on purpose (cost). The pre-push hook runs `vp run ci`; never
  add remote CI without asking.
- **ESM only.** No CommonJS in source or output. The server renders with `react-dom/server.edge` so the production
  bundle has no `require` calls.
- **Data lives in Convex** (`convex/`). Privileged functions call `requireServer`; the app server signs ES256 JWTs with
  `sub: "server"` (`app/.server/convex.ts`). Browsers get user tokens from `/api/convex-token` for live queries.
- **Public shapes only.** Queries return `PublicSlop`/`PublicUser` (`convex/lib/shape.ts`); downvotes, auto-post wiring
  and sealed credentials never leave Convex.
- **Live pages** load data in the route loader, then subscribe with `useLive(query, args, loaderData)`.
- **Ids from forms or URLs** reach Convex as strings and are checked with `ctx.db.normalizeId`, never cast.
- **Agents:** every agent capability is an operation in `app/.server/agent/operations.ts`, served by both MCP (`/mcp`)
  and REST (`/api/v1`). Add new ones there.
- **Voice:** throw slop at the wall, keep slopping until it's slopcessful. Plain words; no restaurant metaphors.
