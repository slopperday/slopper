---
slopper: fix
---

# Page speed counts visits that leave early

A visit that left before the web-vitals chunk loaded or reported sent no `$webVitals`, so the quickest bounces were missing from /analytics/speed. It now sends the first paint and time to first byte the browser already has. The e2e speed test waits for the first paint instead of racing the chunk, and the scheduled-launch test polls for the content check's verdict instead of reading it once.
