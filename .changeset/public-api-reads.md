---
slopper: user_feat
---

# Look anyone up from the API without signing in

Anyone's profile, with their goal day by day, streak and slops, is now at `/api/v1/users/{username}` and the `get_profile` agent tool. That profile, today's race, search, categories, tags and reviews all work without an API token, at up to 120 calls an hour from one address. Signed in, everything works, at up to 1,200 calls an hour, and a call over the limit says when to try again.
