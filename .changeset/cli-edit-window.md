---
cli:
  type: feat
---

# Agents learn when editing closes

Slops now report `editableUntil`. `slopper edit` works until the end of a slop's launch day, or 12 hours after launch if that's later; after that the API refuses it with a plain message, and the skill tells agents to post an update instead.
