---
slopper:
  type: feat
---

# Race tallies and anti-gaming rules for slop of the day

- Slops keep raceUpvotes/raceDownvotes beside their totals: only votes cast on raceDate move them, so the tally stops when the day ends and the crown at 00:01 UTC ranks on it (convex/race.ts raceTally). Older slops fall back to their totals.
- Votes record inRace. countsInRace leaves out votes from accounts younger than LIMITS.raceVoterAge (a day), downvotes from makers with a slop in the same race, and swapped upvotes between two racing makers (the earlier one comes out of its tally too).
- The rules page, /today, llms.txt and the agent skill say what counts.
