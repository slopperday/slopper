import { BarChart, LineChart, SankeyChart } from "echarts/charts";
import { DataZoomInsideComponent, GridComponent, LegendScrollComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

/**
 * ECharts with only what Slopper's charts use, drawn as SVG: crisp at any
 * zoom, and text a browser can select and read. Browser only (.client):
 * EChart.tsx imports it once a chart is on screen.
 */
use([
  LineChart,
  BarChart,
  SankeyChart,
  GridComponent,
  TooltipComponent,
  // One line that scrolls on a phone, rather than wrapping over the plot.
  LegendScrollComponent,
  DataZoomInsideComponent,
  SVGRenderer,
]);

export { init };
