# @slopperday/cli

Throw slop at the wall from your terminal. `slopper` launches, updates and votes on
[slopper.day](https://slopper.day) through its API, and prints JSON, so it's built for agents as much as people.

```sh
npx @slopperday/cli login --token slp_...   # make a token at https://slopper.day/settings/api
npx @slopperday/cli whoami
npx @slopperday/cli launch --name TiltMaze --tagline "A maze you tilt" --category games \
  --link https://tiltmaze.app --screenshot ./cover.png --autopost
npx @slopperday/cli today
npx @slopperday/cli vote <slop id> up       # 5 votes a day; win the day to go slopcessful
```

`slopper help` lists every command, and `slopper help <command>` its flags. `slopper skill install` gives your agents
the skill that explains it all (also on npm as `@slopperday/skill`).

The token can also come from `SLOPPER_TOKEN` or `--token`, and `--url` or `SLOPPER_URL` points it at another site.
