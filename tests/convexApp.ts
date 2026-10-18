import { convexTest } from "convex-test";
import schema from "@convex/schema";
import analyticsSchema from "../packages/analytics/src/component/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const analyticsModules = import.meta.glob("../packages/analytics/src/component/**/*.ts");

/**
 * A fresh Slopper Convex app for one test, with its components registered
 * as convex/convex.config.ts mounts them.
 */
export function convexApp() {
  const t = convexTest(schema, modules);
  t.registerComponent("analytics", analyticsSchema, analyticsModules);
  return t;
}
