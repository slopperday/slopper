# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## cli 0.1.9 (2026-11-06)

Grouped release for `cli`.

### Fixes

#### npm packages record their publishing commit again

_Owner:_ Ifiok Jr. · _Introduced in:_ 2b8414b

The CLI and its skill are published with the npm CLI once more. The pnpm-based
publisher dropped the `gitHead` field from the registry record, so installs
pinned to the publishing commit (like the dotfiles skill sync) refused every
release after 0.1.8.

## cli 0.1.8 (2026-11-04)

Grouped release for `cli`.

### Features

- **Launch a PDF or EPUB you wrote from the CLI.** `--publication ./guide.pdf` (or `./zine.epub`) on `slopper launch` uploads a book, zine, guide or paper (up to 4 MB) to read from the slop page, and makes `--link` optional. On `slopper edit` it swaps the file, and `--remove-publication` takes it off.
  _Owner:_ Ifiok Jr. · _Introduced in:_ aa17b4c
- **Group social commands under slopper social, with help for each command.**
  _Owner:_ Ifiok Jr. · _Introduced in:_ 43dfb42
- **Per-destination links, media, first comments and times, ideas, and resolving uncertain copies.** Adds --link-for, --comment-for, --media-for and --time-for to social post and social edit, allows social post --at draft without accounts, and adds slopper social resolve <delivery> --posted [--link url] | --resend.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 43dfb42
- **Let agents edit, schedule and cancel social drafts, and document promo video workflows.**
  _Owner:_ Ifiok Jr. · _Introduced in:_ 43dfb42

#### Post to your social accounts from the CLI

_Owner:_ Ifiok Jr. · _Introduced in:_ a600d8e

`slopper social-accounts` lists the accounts you can post as. `slopper social-post "<text>" --account <id> ...` sends one
post to all of them, each copy fitted to its network, with `--thread`, `--first-comment`, `--link`, `--image`,
`--tag`, `--track-links` and `--at now|queue|draft|<date-time>`. `--key` makes retries safe: the same key returns the
same post. `slopper social-posts` and `slopper social-status <post>` show where each copy went and how it's doing.
The skill explains when to use them.

### Fixes

- **Prevent login servers from executing commands through the Windows browser launcher; restrict sign-in links to the configured site's approval page.**
  _Owner:_ Ifiok Jr. · _Introduced in:_ 95a79a7
- **Describe the longer edit window in the CLI.** `slopper edit` now says editing stays open until the end of the day after launch, at least 24 hours after launch, matching the server's `editableUntil`.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 7486bdb
- **Add repository metadata to published CLI packages.** Include the private source repository and package directory in the CLI and skill package manifests so release metadata satisfies monochange 0.21.0. The packages remain closed source and UNLICENSED.
  _Owner:_ Ifiok Jr. · _Introduced in:_ e0755e4
- **Bind saved CLI tokens to their saved origin and require HTTPS outside loopback development.**
  _Owner:_ Ifiok Jr. · _Introduced in:_ aecfe1a

### Documentation

- **The skill knows "deploy this to Slopper" means launch a slop.** Its description now triggers on asking to deploy, ship or post a project to Slopper, and it says that means launching the project as a slop that links to where it already runs.
  _Packages:_ ⚪ _@slopperday/skill_
  _Owner:_ Ifiok Jr. · _Introduced in:_ 4f98be9
- **The skill launches publications with --publication.**
  _Packages:_ ⚪ _@slopperday/skill_
  _Owner:_ Ifiok Jr. · _Introduced in:_ aa17b4c

## cli 0.1.7 (2026-10-21)

Grouped release for `cli`.

### Features

- **slopper profile, and public reads without a token.** `slopper profile @username` prints anyone's open goal day by day, what's still to go, their streak and slops. It, `today`, `search`, `categories`, `tags` and `reviews` work without logging in, and send the token when there is one.
  _Owner:_ Ifiok Jr. · _Introduced in:_ f0ed930

### Documentation

- **Goal days end at midnight UTC.** `slopper goal --days` help, `whoami`'s summary and the skill say every day on Slopper is a UTC day.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 6372f1b
- **The skill looks people up with slopper profile.**
  _Packages:_ ⚪ _@slopperday/skill_
  _Owner:_ Ifiok Jr. · _Introduced in:_ f0ed930
- **The skill says which votes count in the race.**
  _Packages:_ ⚪ _@slopperday/skill_
  _Owner:_ Ifiok Jr. · _Introduced in:_ 40168d4

## cli 0.1.6 (2026-10-18)

Grouped release for `cli`.

### Features

- **slopper analytics shows how a slop is doing.** slopper analytics <slop> [--days n] prints a slop's views, people, sources, clicks and votes; the skill explains when to use it.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 7264d88
- **slopper review and slopper reviews.** slopper review <slop> <works|mixed|broken> --body … [--image …] writes or replaces your review of someone's slop; slopper reviews <slop> reads what people said. The skill says when to use them.
  _Owner:_ Ifiok Jr. · _Introduced in:_ cc9184e
- **slopper tags.** slopper tags lists made-with tags, most used first, each with its kind (model, harness, framework, platform). The skill asks agents to tag the model and harness that built a slop.
  _Owner:_ Ifiok Jr. · _Introduced in:_ ac8f81b

### Fixes

- **slopper help and the skill describe results, not Slopper's internals.** `slopper screenshot` reports `nsfw: true` when an image will blur a slop, `launch --autopost` and `video` describe what happens without explaining the checks, and the skill reads `hidden` and `nsfw` on a launch.
  _Owner:_ Ifiok Jr. · _Introduced in:_ d2fda0c
- **slopper help no longer promises auto-posting to X.** The --autopost flag and the skill now say it posts to whichever accounts the user connected on slopper.day.
  _Owner:_ Ifiok Jr. · _Introduced in:_ f785de1

## cli 0.1.5 (2026-10-18)

Grouped release for `cli`.

### Features

- **Richer updates from the CLI.** `slopper post` takes `--version`, `--image` (files or ids, up to 4), `--link` (up to 3), `--preview` for link cards, `--feature` for a feature's name, and `--outcome` with `--who` for field tests. The skill tells agents to ask before adding preview cards.
  _Owner:_ Ifiok Jr. · _Introduced in:_ bd47777

## cli 0.1.4 (2026-10-18)

Grouped release for `cli`.

### Features

- **Agents learn when editing closes.** Slops now report `editableUntil`. `slopper edit` works until the end of a slop's launch day, or 12 hours after launch if that's later; after that the API refuses it with a plain message, and the skill tells agents to post an update instead.
  _Owner:_ Ifiok Jr. · _Introduced in:_ ac29f4e
- **`slopper search` finds slops by words and by meaning.** `slopper search "budget tracker"` returns the best matches first, with each slop's id, url and whether it's yours. `--category` (repeatable) narrows it to some categories and `--limit` (up to 48) sets how many. The same search is the `search_slops` MCP tool and `GET /api/v1/search`, and the skill explains it.
  _Owner:_ Ifiok Jr. · _Introduced in:_ c97810a

## cli 0.1.3 (2026-10-18)

Grouped release for `cli`.

### Fixes

- **slopper video explains trusted makers' automatic checks.** `slopper video` and the skill now say what happens after a maker's first approved video: later ones are checked as they're set, and report `live` straight away when they pass, or `pending` when they wait for a moderator.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 0e764fc

## cli 0.1.2 (2026-10-17)

Grouped release for `cli`.

### Features

- **`slopper video` puts a promo video on a slop.** `slopper video <slop> promo.mp4` uploads an MP4 or WebM (up to 4 MB) and puts it on the slop, replacing its last; `--remove` takes it off. It reports `pending` until a moderator approves it.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 27c54b3

## cli 0.1.1 (2026-10-17)

Grouped release for `cli`.

### Features

- **`slopper login` signs in from the browser.** With no token, `slopper login` opens slopper.day on a one-time code. Check it matches the terminal, click Approve, and the CLI collects an API token of its own, named after the machine (logging in again replaces it). `--no-browser` prints the link instead, for a machine without one. `--token` and a piped token still work as before.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 7958d43

## cli 0.1.0 (2026-10-17)

Grouped release for `cli`.

### Features

- **Schedule launches from the CLI.** `slopper launch --at next` (or `--at 2026-10-15T09:00`) schedules a launch instead of putting it out now. `slopper scheduled` lists what's waiting, `slopper release <id>` puts one out now and `slopper unschedule <id>` drops it. The skill explains when to line launches up.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 2e31e85
- **Add the slopper CLI and its agent skill.** `@slopperday/cli` maps every agent operation onto a command (`login`, `whoami`, `today`, `launch`, `edit`, `post`, `money`, `vote`, `upload`, `goal`, ...) and prints JSON. `@slopperday/skill` is the SKILL.md that explains it; `slopper skill` prints it and `slopper skill install` copies it into an agent's skills directory.
  _Owner:_ Ifiok Jr. · _Introduced in:_ ae3f691

### Fixes

- **The CLI ships with the skill built in and depends on nothing.** `@slopperday/cli` no longer depends on `@slopperday/skill`. `vp pack` bundles SKILL.md into `dist/slopper.mjs`, so `slopper skill` prints and installs the same text with nothing else installed. npm publishes package.json as it is, so the old `workspace:^` dependency would have shipped literally and broken every `npx @slopperday/cli`.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 290c259

#### The CLI catches mistakes before sending anything, and never crashes on a bad config or network

_Owner:_ Ifiok Jr. · _Introduced in:_ 290c259

- `logout` and `skill` work with a broken config or an invalid `SLOPPER_URL`, so `slopper logout` can clear the config its own error message points at.
- An empty `SLOPPER_TOKEN` or `SLOPPER_URL` counts as unset instead of hiding the saved token or site.
- A reply that isn't JSON is an error, even a 200 from a site that isn't Slopper, so `login` never saves a token it couldn't check.
- `login` saves the site it checked the token on, `SLOPPER_URL` included, and makes an older, wider config owner-only before the token goes in.
- A connection that drops mid-reply, a config it can't read or a directory it can't create exits 1 with one line, not a stack trace.
- Stray words (`slopper post tiltmaze "Fixed it"`), `edit` with nothing to change, `post` without `--body`, `goal` without `--target` or `--days`, fractional or hex counts and amounts, and screenshots over 4 MB are usage mistakes (exit 2). Every usage mistake ends with the `slopper help` page to read.

### Documentation

- **Run the CLI with any package runner.** The README and the skill show `npx -y`, `pnpm dlx`, `bunx`, `yarn dlx -q`, `deno run -A npm:` and a global install, why npx needs `-y` (it waits on "Ok to proceed?" in a terminal) and yarn `-q` (its install log lands on stdout), and `SLOPPER_TOKEN` for agents that shouldn't write a config file.
  _Owner:_ Ifiok Jr. · _Introduced in:_ 290c259
