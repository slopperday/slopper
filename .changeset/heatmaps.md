---
slopper:
  type: feat
---

# Heatmaps

- The analytics SDK sends where every click lands as `$heatmap` events (up to 50 points per page and viewport width), and page leaves carry the viewport width. Clicks inside `data-no-capture` aren't kept, and the SDK doesn't run inside frames.
- A `heatmap` insight places clicks for phones, tablets or desktops, and counts views, scroll depth and the most-clicked links and buttons.
- Admins see it at /analytics/heatmaps: the page as it is now, in a same-origin frame (the CSP now allows Slopper to frame its own pages), with its clicks over it. Agents get it with `slopper admin analytics heatmap`.
