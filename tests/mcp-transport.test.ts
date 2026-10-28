import { Agent, createServer, request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createRequestListener } from "../scripts/request-listener";

const { allowance } = vi.hoisted(() => ({ allowance: vi.fn<typeof import("~/.server/tokens").allowAction>() }));
vi.mock("~/.server/tokens", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/.server/tokens")>()),
  allowAction: allowance,
}));

const { handleMcp } = await import("~/.server/agent/mcp");

afterEach(() => {
  allowance.mockReset();
});

/** Uploads the rest only after response headers arrive, then permits reuse. */
function statusOf({
  url,
  agent,
  method,
  body = "",
}: {
  url: URL;
  agent: Agent;
  method: string;
  body?: string;
}): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      { agent, method, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
      (response) => {
        if (body) request.end(body.slice(1));

        response.once("error", reject);
        response.once("end", () => resolve(response.statusCode));
        response.resume();
      },
    );
    request.once("error", reject);
    request.setTimeout(1_000, () =>
      request.destroy(new Error("The HTTP connection did not answer before its test timeout.")),
    );

    if (body) request.write(body.slice(0, 1));
    else request.end();
  });
}

describe("MCP rejection transport", () => {
  it.each([
    { method: "POST", allowed: true, status: 401 },
    { method: "POST", allowed: false, status: 429 },
    { method: "PUT", allowed: true, status: 405 },
  ])("keeps the connection usable after a prompt $status response", async ({ method, allowed, status }) => {
    allowance.mockResolvedValue(allowed);
    const server = createServer(
      createRequestListener(async (request) =>
        new URL(request.url).pathname === "/mcp" ? await handleMcp(request) : new Response("ready"),
      ),
    );
    let connections = 0;
    server.on("connection", () => connections++);
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();

      if (address === null || typeof address === "string") throw new Error("Expected a TCP listener.");

      const origin = `http://127.0.0.1:${address.port}`;
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", padding: "x".repeat(100_000) });

      expect(await statusOf({ url: new URL("/mcp", origin), agent, method, body })).toBe(status);
      expect(await statusOf({ url: new URL("/healthy", origin), agent, method: "GET" })).toBe(200);
      expect(connections).toBe(1);
    } finally {
      agent.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
