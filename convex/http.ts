import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { analytics } from "./analytics";

const http = httpRouter();

// The analytics SDK sends from the site's pages straight here
// (`<deployment>.convex.site/a/e`), so no app server runs per event.
const appUrl = process.env.APP_URL;
analytics.registerRoutes(http, {
  allowedOrigins: appUrl ? [new URL(appUrl).origin] : "*",
  // Everything on a slop's page counts for that slop (convex/analytics.ts `slopReport`).
  groupsForPaths: async (ctx, paths) => {
    const found = await ctx.runQuery(internal.analytics.slopGroupsForPaths, { paths });
    return new Map(found.map(({ path, group }) => [path, group]));
  },
});

export default http;
