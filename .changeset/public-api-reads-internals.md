---
slopper: feat
---

# Public operations and per-address rate limits

- Operations are `UserOperation` or `PublicOperation` (`app/.server/agent/operations.ts`); `runOperation` refuses a user operation without a user. REST serves public ones without a token; a bad token is still a 401 everywhere. MCP still needs a token.
- `apiQuota` (`app/.server/tokens.ts`) keys calls by user, or by `callerAddress` without one, with `LIMITS.apiCallsPerHour` and `LIMITS.anonymousApiCallsPerHour`; a 429 carries `Retry-After`.
- `users.profile` returns the owner's `today`.
