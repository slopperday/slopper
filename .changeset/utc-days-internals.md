---
slopper:
  type: fix
---

# Launch days are UTC days

- `insertLaunch` dates a launch itself: `launchDate` is the UTC date it went out, the same as `raceDate`. `slops.create` no longer takes `today`, and goal, profile, streak, scheduling and edit-window code use `utcDate` (app/lib/dates.ts). `timeZone` is only for clock times, typed wall times and the digest.
- `raceStartOn` and `localDayStart` are gone: the next free day starts at its midnight UTC.
- `launchDays.toUtcDays` (internal) lists launches whose `launchDate` was their maker's local date and, with `apply`, moves them onto their `raceDate` with their goal day; `launchDays.moveLaunch` backdates one launch for the e2e tests.
