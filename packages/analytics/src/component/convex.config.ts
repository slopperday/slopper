import { defineComponent } from "convex/server";

/**
 * The analytics component: its own tables and functions inside the app's
 * Convex deployment, so the data never leaves it. An app mounts it with
 * `app.use(analytics)` in convex/convex.config.ts and reaches it through
 * `components.analytics` (see the package README).
 */
const component = defineComponent("analytics");

export default component;
