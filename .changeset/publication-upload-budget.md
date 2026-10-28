---
slopper:
  type: fix
---

# Bound publication upload attempts before parsing

Limit browser body reads by account and address. Charge malformed and rejected publications against the upload budget before safety scans or decompression.
