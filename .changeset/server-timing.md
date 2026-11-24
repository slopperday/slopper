---
slopper:
  type: feat
---

# Server-Timing on every response, and quicker cold starts

app/.server/timing.ts (first in the root middleware) adds Server-Timing to every response: app (the whole request), convex (time waiting on Convex, with its round trips and calls; calls that overlap are one round trip) and, on a server's first request, cold (process start to that request). The card renderer (satori, resvg and the fonts inlined as base64, 3.4 MB) and @simplewebauthn/server (about 190 ms to load) are now imported when first used, so the server entry is 1.6 MB instead of 5.1 MB.
