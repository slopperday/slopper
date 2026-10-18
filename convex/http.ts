import { httpRouter } from "convex/server";
import { analytics } from "./analytics";

const http = httpRouter();

// The analytics SDK sends from the site's pages straight here
// (`<deployment>.convex.site/a/e`), so no app server runs per event.
const appUrl = process.env.APP_URL;
analytics.registerRoutes(http, { allowedOrigins: appUrl ? [new URL(appUrl).origin] : "*" });

export default http;
