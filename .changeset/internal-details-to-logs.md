---
slopper:
  type: fix
---

# Keep internals out of user-facing messages

Raw details now go to the logs instead of the page: a social network's refusal (status and body, `expectOk` in `app/.server/social/adapters.ts`), unexpected posting errors (`describeError`), sign-in callback errors, and why the video check couldn't run (its recorded reason is now "Couldn't check this video."). /mod no longer shows the checker's model and provider; `videoChecks` still records them.
