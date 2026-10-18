---
slopper:
  type: feat
---

# Analytics dashboards read daily rollups

- A daily cron (04:00 UTC) rolls each finished day of first-party analytics into rollup rows: web analytics, each event's count and people, and each slop's page views. Web analytics, trends without filters or breakdown, and the projects leaderboard read whole past days from them and raw events only for today and the partial day at the start, with the same answers. On a seeded month of 2,000 visits, the 30-day traffic page read 13.9 MB of events before and 0.9 MB after.
- A day is read raw again as soon as anything changes it (a late batch, a session past midnight, a merge, a forgotten person), until the next roll-up does it again.
- Events lose their timestamp-only index: reading every event and the retention sweep go name by name instead. After deploying, backfill once with `convex run analytics:rollUp '{"lookbackDays": 365}'`.
