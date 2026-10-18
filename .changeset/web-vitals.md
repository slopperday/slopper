---
slopper:
  type: feat
---

# Web vitals

- The analytics SDK measures the landing page's Core Web Vitals (LCP, INP, CLS, FCP, TTFB) with `web-vitals`, in its own chunk loaded after the SDK, and sends them as `$webVitals` when the page is hidden.
- A `vitals` insight gives each one's 75th percentile with web.dev's rating and the shares of good, middling and poor loads, overall and per page. Admins see it at /analytics/speed; agents with `slopper admin analytics vitals`.
