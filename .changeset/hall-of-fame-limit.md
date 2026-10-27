---
slopper:
  type: fix
---

# Bound anonymous hall-of-fame queries

Cap hall-of-fame reads and card expansion at 100 winners. Normalize finite result limits to non-negative integers and reject non-finite limits before database work.
