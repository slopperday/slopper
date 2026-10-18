---
slopper:
  type: fix
---

# Analytics costs a page's first load nothing

- The analytics SDK isn't in any script a page loads to render: the React provider imports it after the load event, when the browser is idle, and the landing page view is stamped with when the page was opened. A failed import leaves the page uncounted and nothing else broken.
- A burst of activity writes the session to localStorage once, not once per event.
- e2e: the browser launches with a real user agent. Requests a page finishes after it's gone (analytics' leave beacons) carry the browser's own, which says HeadlessChrome and was dropped as a bot's; `e2e/performance.spec.ts` checks the SDK stays out of the first load, arrives and sends after it, and that a page left at once still sends what it saw.
