---
cli: feat
---

# Post to your social accounts from the CLI

`slopper social-accounts` lists the accounts you can post as. `slopper social-post "<text>" --account <id> ...` sends one
post to all of them, each copy fitted to its network, with `--thread`, `--first-comment`, `--link`, `--image`,
`--tag`, `--track-links` and `--at now|queue|draft|<date-time>`. `--key` makes retries safe: the same key returns the
same post. `slopper social-posts` and `slopper social-status <post>` show where each copy went and how it's doing.
The skill explains when to use them.
