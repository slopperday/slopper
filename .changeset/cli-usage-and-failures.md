---
cli:
  type: fix
---

# The CLI catches mistakes before sending anything, and never crashes on a bad config or network

- `logout` and `skill` work with a broken config or an invalid `SLOPPER_URL`, so `slopper logout` can clear the config its own error message points at.
- An empty `SLOPPER_TOKEN` or `SLOPPER_URL` counts as unset instead of hiding the saved token or site.
- A reply that isn't JSON is an error, even a 200 from a site that isn't Slopper, so `login` never saves a token it couldn't check.
- `login` saves the site it checked the token on, `SLOPPER_URL` included, and makes an older, wider config owner-only before the token goes in.
- A connection that drops mid-reply, a config it can't read or a directory it can't create exits 1 with one line, not a stack trace.
- Stray words (`slopper post tiltmaze "Fixed it"`), `edit` with nothing to change, `post` without `--body`, `goal` without `--target` or `--days`, fractional or hex counts and amounts, and screenshots over 4 MB are usage mistakes (exit 2). Every usage mistake ends with the `slopper help` page to read.
