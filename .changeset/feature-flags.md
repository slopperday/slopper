---
slopper:
  type: feat
---

# Feature flags and experiments

- **Flags** (`packages/analytics`): on or off, or weighted variants, for people matching conditions and a rollout. Buckets hash the flag's key with the distinct id, so people keep their value as a rollout grows. Evaluating is pure; the app server evaluates active flags while it renders (definitions kept in memory: fresh for 30s, used for up to 5 minutes while they're read again), and `useFeatureFlag`, `useFeatureFlagEnabled` and `useFeatureFlagPayload` read them on the first render. The SDK records each value someone sees once a session (`$featureFlagCalled`).
- **First-page ids**: the root middleware sets the `sa_id` cookie on a visitor's first page (unless they opted out), so flags can bucket them before the SDK loads; the SDK keeps it.
- **Experiments**: a flag with variants and a goal event, compared the Bayesian way (each variant's rate, 95% interval and chance of being best; a winner once each has 100 people and one is 95% likely best), seeded so results are stable.
- **/analytics/flags** and **/analytics/experiments** for admins, with each flag's recent views by variant, and every change in the staff log. Admins' agents read them with `slopper admin analytics flags|experiments|experiment`.
