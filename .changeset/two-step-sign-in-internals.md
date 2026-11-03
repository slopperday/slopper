---
slopper:
  type: feat
---

# Add second factors and step-up confirmation to sign-in

- `convex/security.ts`: TOTP factors (sealed secrets, each 30-second step usable once), passkeys (WebAuthn via
  `@simplewebauthn/server`, counter regression refused), hashed one-time recovery codes, short-lived `authChallenges`
  (five tries each, ten per person per 15 minutes) and a per-user `securityEvents` log.
- `app/.server/auth/twoFactor.ts`: `secondFactorGate` holds the session after OAuth until `/login/verify` passes;
  `requireRecentAuth` sends sensitive actions to confirm when the session's `verifiedAt` is over 15 minutes old.
- Sessions record `verifiedAt` and the browser, are indexed by user, and can be ended from `/settings/security`.
