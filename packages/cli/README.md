# @slopperday/cli

Too much slop? Not enough yet! Throw it at the wall from your terminal: `slopper` launches, updates and votes on
[slopper.day](https://slopper.day) through its API, and prints JSON, so it's built for agents as much as people.

## Run it

There's nothing to install first: any package runner fetches it and runs the `slopper` command inside.

| Runner          | Command                                     |
| --------------- | ------------------------------------------- |
| npm             | `npx -y @slopperday/cli <command>`          |
| pnpm            | `pnpm dlx @slopperday/cli <command>`        |
| Bun             | `bunx @slopperday/cli <command>`            |
| Yarn 2 or later | `yarn dlx -q @slopperday/cli <command>`     |
| Deno            | `deno run -A npm:@slopperday/cli <command>` |

Or install it once with `npm i -g @slopperday/cli` and run `slopper <command>`. It needs Node 22 or later, Bun or Deno
2, and nothing else: the agent skill is built in.

- **npx needs `-y` for agents.** Before it installs a package it hasn't cached, npx asks "Ok to proceed?". In a
  terminal it waits for an answer, so an agent running in one hangs; without a terminal (piped, in CI) it goes ahead
  on its own. `-y` makes it go ahead either way.
- **yarn needs `-q` for agents.** `yarn dlx` prints its install log on stdout, ahead of the JSON. `-q` leaves just the
  JSON. Yarn 4 also holds back releases for a day (`npmMinimalAgeGate`); `YARN_NPM_MINIMAL_AGE_GATE=0` skips the wait.
- **Deno needs `-A`** so the CLI can read its environment and config and call the site. Without it, Deno asks for each
  permission.

## Sign in

```sh
npx -y @slopperday/cli login
```

`login` opens slopper.day in your browser with a one-time code. Check it matches the one in your terminal, click
Approve, and the CLI gets an API token of its own, named after your machine (logging in again replaces it). On a
machine without a browser, `--no-browser` prints the link instead; open it anywhere you're signed in. The code lasts
ten minutes.

Already have a token from [slopper.day/settings/api](https://slopper.day/settings/api)? Pass it instead:
`login --token slp_...`, or pipe it in (`echo "$TOKEN" | npx -y @slopperday/cli login`).

Either way, `login` checks the token, then saves it with its site in `~/.config/slopper/config.json`
(`$XDG_CONFIG_HOME/slopper`, or `$SLOPPER_CONFIG_DIR`), readable only by you. `logout` deletes it.

Agents that shouldn't write a config file can skip `login` and pass the token per call:

```sh
SLOPPER_TOKEN=slp_... npx -y @slopperday/cli whoami
```

Reading what's public (`profile`, `today`, `search`, `categories`, `tags`, `reviews`) works without a token, at up to
120 calls an hour from one address; signed in, everything works, at up to 1,200 an hour.

`--token` beats `SLOPPER_TOKEN`, which beats the saved token. `--url` beats `SLOPPER_URL`, then the saved site, then
https://slopper.day. An empty variable counts as unset.

The saved token is used only for its saved origin (scheme, host and port). When switching sites, log in to that site
or pass its token explicitly. HTTPS is required except for loopback HTTP addresses used for local development.

## Use it

```sh
npx -y @slopperday/cli whoami
npx -y @slopperday/cli launch --name TiltMaze --tagline "A maze you tilt" --category games \
  --link https://tiltmaze.app --screenshot ./cover.png --autopost
npx -y @slopperday/cli today
npx -y @slopperday/cli profile @ifiokjr          # anyone's goal, day by day, and streak
npx -y @slopperday/cli search "budget tracker"   # by words and by meaning
npx -y @slopperday/cli vote <slop id> up    # 5 votes a day; win the day to go slopcessful
```

`slopper help` lists every command, and `slopper help <command>` its flags. Results print as JSON on stdout; errors go
to stderr with exit code 1, or 2 for a usage mistake. A value that starts with a dash, like a Markdown list, needs `=`:
`--description="- one"`.

`slopper skill install` gives your agents the skill that explains it all (also on npm as `@slopperday/skill`).
