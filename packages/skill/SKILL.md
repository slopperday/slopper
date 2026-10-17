---
name: slopper
description: Ship to slopper.day from the terminal with the `slopper` CLI (npm @slopperday/cli). Use when the user wants to launch a project as today's slop or schedule launches for later days, post an update or field test, set a daily shipping goal, log costs or revenue, check today's slop of the day race, or vote on slops.
---

# Slopper

[slopper.day](https://slopper.day) is where people throw slop at the wall every day: they ship something small
daily (a site, a TestFlight or Play beta, a repo), set a goal like 30 slops in 30 days, and keep slopping until one is
slopcessful. Every UTC day the slops launched that day race on votes; the leader at midnight UTC wins slop of the day
and goes slopcessful. Slopcessful is earned, never declared: nobody can mark their own slop slopcessful.

## Setup

Run the CLI without installing it, with the runner the project already uses:

```sh
npx -y @slopperday/cli <command>            # -y, or npx stops to ask "Ok to proceed?" and waits
pnpm dlx @slopperday/cli <command>
bunx @slopperday/cli <command>
yarn dlx -q @slopperday/cli <command>       # -q, or yarn's install log lands in the JSON
deno run -A npm:@slopperday/cli <command>
```

Or install it once (`npm i -g @slopperday/cli`) and run `slopper`. The examples below say `slopper`: put the runner's
command in its place.

It needs the user's API token. They make one at https://slopper.day/settings/api. Ask them for it if you don't have one,
then either save it or pass it per call:

```sh
slopper login --token slp_...          # checks it, then saves it readable by the user only
SLOPPER_TOKEN=slp_... slopper whoami   # saves nothing: use this when you shouldn't write files
```

`--url` (or `SLOPPER_URL`) points it at another site, like a local one.

Every command prints JSON on stdout. Errors go to stderr with exit code 1 (2 for a usage mistake), and validation
errors list each field that needs fixing. `slopper help <command>` shows every flag. A value that starts with a dash,
like a Markdown list, needs `=`: `--description="- one"`.

## Start with whoami

`slopper whoami` returns the user's username, time zone, today's date in that zone, the open goal and its progress, the
streak, and the votes left today. Goal days end at midnight in the user's time zone; the race runs on UTC days.

## Launch a slop

1. Read the project: README, package.json or pubspec.yaml, and any deployed URL, App Store, TestFlight or Play beta
   links.
2. Take 1 to 3 screenshots of it running. The first is the cover.
3. Pick a category from `slopper categories`.
4. Launch it. Screenshot files are uploaded for you:

```sh
slopper launch \
  --name "TiltMaze" \
  --tagline "A marble maze you play by tilting your phone" \
  --category games \
  --description "Built in a day. Tilt to roll, find the exit before the timer runs out." \
  --link website=https://tiltmaze.app \
  --link testflight=https://testflight.apple.com/join/abc123 \
  --screenshot ./shots/cover.png --screenshot ./shots/level-2.png \
  --made-with Flutter --made-with Claude \
  --note "Day 12: a maze you tilt. Try to beat 40 seconds." \
  --autopost
```

Link kinds: `website`, `app_store`, `testflight`, `play_store`, `play_beta`, `source`, `other`. A bare URL is a
website. Store links must use their store's domain.

The result has the slop's `id`, `slug` and `url`, and the content check's verdict. Give the user the URL.

`--autopost` posts the launch to the user's connected X, LinkedIn and Bluesky accounts. It's held (with the reason)
unless the slop passed the automated content check and nobody has flagged it. Write the `--note` in the user's voice,
two sentences at most.

A new platform or a 2.0 is a new launch with its own shot at slop of the day:
`slopper launch --relaunch-of <slop> --label "iOS app" ...`. A new feature is an update, not a launch.

## Schedule launches

When several things are ready at once, ask the user whether to put them all out now or line them up. Every launch
counts towards the goal on the day it goes out: three today are three slops today, and three lined up fill three days,
each with its own shot at slop of the day.

```sh
slopper launch --at next ...                 # the next day with nothing out or scheduled, as its race starts
slopper launch --at 2026-10-15T09:00 ...     # the user's time zone, unless it has an offset
slopper scheduled                            # what's waiting, soonest first
slopper release <scheduled>                  # put it out now instead
slopper unschedule <scheduled>               # drop it
```

Nobody else sees a scheduled launch until it goes out. `--autopost` posts it then.

## Keep it alive

```sh
slopper post tiltmaze --kind feature --body "Level editor: build a maze and share the link." --autopost
slopper post tiltmaze --kind field --body "Showed it to 5 people at the bus stop. 3 got hooked."
slopper edit tiltmaze --tagline "Now with a level editor" --screenshot ./shots/editor.png
slopper money tiltmaze cost 12.99 --category domain --note "tiltmaze.app"
```

Update kinds: `update` (fixes, news), `feature` (something new shipped), `field` (a real-world test: ask the user who
tried it and what they said), `repromote` (bump it back up). `<slop>` is one of the user's slops, by id or slug (see
`slopper slops`). `edit` changes only the flags passed; `--link` and `--screenshot` replace the whole list.

## Goals

Ask how many days first (7, 14, 30 or 100 are common), then how hard: one slop every five days is safe, every other day
is getting there, one a day is hardcore, two a day is impossible.

```sh
slopper goal --days 30 --target 30
```

Only one goal can be open at a time.

## The race and votes

`slopper today` ranks today's slops by votes, with each slop's `id`, whether it's the user's (`yours`), how they voted
(`yourVote`), and `votesLeft`.

```sh
slopper vote <slop id> up      # or down (private: lowers the ranking, nobody sees it), or clear
```

Everyone gets 5 votes per UTC day. Switching today's vote is free and clearing it gives it back. Nobody can vote on
their own slops. Votes decide slop of the day, so only vote the way the user asks; never spend their votes on your own
judgement.

## Don't

- Don't launch ideas, waitlists or anything that isn't live: a slop is something people can try today.
- Don't launch features as new slops; post them as updates.
- Don't put the token in files you commit. Use `slopper login` or `SLOPPER_TOKEN`.
