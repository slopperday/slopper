---
cli:
  type: feat
---

# `slopper login` signs in from the browser

With no token, `slopper login` opens slopper.day on a one-time code. Check it matches the terminal, click Approve, and the CLI collects an API token of its own, named after the machine (logging in again replaces it). `--no-browser` prints the link instead, for a machine without one. `--token` and a piped token still work as before.
