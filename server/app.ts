import { createRequestHandler } from "react-router";
import * as build from "virtual:react-router/server-build";

/**
 * The production request handler, bundled together with the app so the
 * server build is one self-contained ESM module (see deploy/main.ts).
 */
export const handler: (request: Request) => Promise<Response> = createRequestHandler(build, "production");
