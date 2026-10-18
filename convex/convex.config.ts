import { defineApp } from "convex/server";
import analytics from "@slopperday/analytics/convex.config";

/** Slopper's Convex app, with first-party analytics as a component (packages/analytics). */
const app = defineApp();
app.use(analytics);

export default app;
