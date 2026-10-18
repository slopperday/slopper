---
slopper:
  type: feat
---

# Surveys

- Admins ask one question on the pages they pick, at /analytics/surveys: a rating, 0 to 10, one of a few options, or words, with an optional follow-up, for anyone, signed-in people or visitors, after a delay. Starting, stopping and changes go in the staff log.
- Pages get running surveys from the root loader (kept in memory, so they cost a page nothing) unless analytics is off. A small card asks the first one this browser hasn't answered or closed, once. Answers are analytics events, so a survey's results (who saw it, answered and closed it, the answers charted, the average or Net Promoter Score, and what people wrote, linked to their visits) come from a `survey` insight. Agents read them with `slopper admin analytics surveys` and `survey --q <key>`.
- Flags and surveys share one in-memory cache on the app server (`remembered`).
