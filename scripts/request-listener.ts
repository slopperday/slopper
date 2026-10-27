import { createRequestListener as createFetchListener, type FetchHandler } from "@remix-run/node-fetch-server";
import type { RequestListener } from "node:http";

/**
 * Keeps an early rejection from stranding a cancelled request body on its
 * keep-alive socket. Node discards the remaining bytes after the response,
 * so refusing a request never waits for its upload or parses its body.
 */
export function createRequestListener(handler: FetchHandler): RequestListener {
  const listener = createFetchListener(handler);

  return (request, response) => {
    response.once("finish", () => {
      request.resume();
    });
    listener(request, response);
  };
}
