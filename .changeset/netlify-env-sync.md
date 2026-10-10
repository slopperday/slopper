---
slopper: fix
---

# Netlify environment sync sets every variable

netlify-cli 27 exits 0 without setting anything when `env:set` gets `--scope`, so the first sync reported 21 variables and set none. `vp run env:netlify` drops the flag, checks Netlify has every variable afterwards, and refuses a `SLOPPER_JWT_PRIVATE_KEY` that doesn't decode before it sets anything.
