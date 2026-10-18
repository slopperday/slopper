---
slopper:
  type: feat
---

# Charts on ECharts, with comparisons

- The analytics charts are ECharts now, loaded in their own chunk once a chart is on screen (about 167 KB brotli, never on public pages): lines with a crosshair tooltip and a legend that turns lines on and off, stacked columns, funnels that show who dropped off, and journeys as a Sankey diagram you can trace by hovering. Long ranges zoom with ctrl and the wheel, or a pinch. Every chart keeps its table.
- Comparisons with the period before: trends take `compare` ("Compare with the period before" on /analytics/insights), and traffic and a slop's views draw the days before as a dashed line, with the change in the tooltip. Web and slop reports carry `previousSeries`.
- Charts animate unless motion is turned down, in Settings or on the device.
