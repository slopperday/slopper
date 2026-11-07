/**
 * Stand-ins for GitHub, X and LinkedIn, for the walkthrough video
 * (e2e/demo/studio-flow.demo.ts). The stack loads this into the app server
 * with `node --import` when `E2E_APP_IMPORT` names it, so signing in,
 * connecting accounts and posting run the real code and only the networks'
 * answers are made up. Everything else goes to the real `fetch`.
 *
 * What the networks were sent is listed at `http://127.0.0.1:<DEMO_NETWORK_PORT>/`,
 * which the video shows after posting.
 */
import { createServer } from "node:http";
import process from "node:process";

interface Received {
  network: string;
  what: string;
  text?: string;
  at: number;
}

const received: Received[] = [];
const realFetch = globalThis.fetch;
let nextId = 1_900_000_000_000_000_000n;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "content-type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  });
}

async function bodyText(init: RequestInit | undefined): Promise<string> {
  const body = init?.body;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  return "";
}

async function answer(url: URL, init: RequestInit | undefined): Promise<Response | null> {
  const method = (init?.method ?? "GET").toUpperCase();
  const place = `${url.host}${url.pathname}`;

  // GitHub: signing up.
  if (place === "github.com/login/oauth/access_token")
    return json({ access_token: "demo-github", token_type: "bearer", scope: "read:user,user:email" });
  if (place === "api.github.com/user")
    return json({ id: 4242001, login: "ada-builds", name: "Ada Builds", avatar_url: null, email: null });
  if (place === "api.github.com/user/emails")
    return json([{ email: "ada@example.com", primary: true, verified: true }]);

  // X: connecting, then posting.
  if (place === "api.x.com/2/oauth2/token")
    return json({ access_token: "demo-x", refresh_token: "demo-x-refresh", expires_in: 7200, token_type: "bearer" });
  if (place === "api.x.com/2/users/me")
    return json({ data: { id: "1700000000000000001", username: "adabuilds", name: "Ada Builds" } });
  if (place === "api.x.com/2/media/upload/initialize") return json({ data: { id: String(nextId++) } });
  if (/^api\.x\.com\/2\/media\/upload\/\d+\/append$/.test(place)) return new Response(null, { status: 204 });
  if (/^api\.x\.com\/2\/media\/upload\/\d+\/finalize$/.test(place)) {
    received.push({ network: "X", what: "Picture uploaded", at: Date.now() });
    return json({ data: {} });
  }
  if (place === "api.x.com/2/media/metadata") return json({ data: {} });
  if (place === "api.x.com/2/media/upload") return json({ data: {} });
  if (place === "api.x.com/2/tweets" && method === "POST") {
    const sent = JSON.parse(await bodyText(init)) as { text: string; reply?: unknown };
    received.push({ network: "X", what: sent.reply ? "Reply" : "Post", text: sent.text, at: Date.now() });
    return json({ data: { id: String(nextId++) } }, { status: 201 });
  }
  if (place === "api.x.com/2/tweets" && method === "GET") {
    const ids = url.searchParams.get("ids")?.split(",") ?? [];
    return json({
      data: ids.map((id) => ({
        id,
        public_metrics: { impression_count: 1840, like_count: 96, reply_count: 7, retweet_count: 12, quote_count: 2 },
      })),
    });
  }

  // LinkedIn: connecting, then posting.
  if (place === "www.linkedin.com/oauth/v2/accessToken")
    return json({ access_token: "demo-linkedin", expires_in: 5_184_000, scope: "openid profile w_member_social" });
  if (place === "api.linkedin.com/v2/userinfo") return json({ sub: "demo-ada", name: "Ada Builds", given_name: "Ada" });
  if (place === "api.linkedin.com/rest/images")
    return json({
      value: { uploadUrl: "https://www.linkedin.com/dms-uploads/demo", image: `urn:li:image:demo${nextId++}` },
    });
  if (place === "www.linkedin.com/dms-uploads/demo") {
    received.push({ network: "LinkedIn", what: "Picture uploaded", at: Date.now() });
    return new Response(null, { status: 201 });
  }
  if (place === "api.linkedin.com/rest/posts" && method === "POST") {
    const sent = JSON.parse(await bodyText(init)) as { commentary: string };
    received.push({
      network: "LinkedIn",
      what: "Post",
      text: sent.commentary.replace(/\\(.)/g, "$1"),
      at: Date.now(),
    });
    return new Response(null, { status: 201, headers: { "x-restli-id": `urn:li:share:${nextId++}` } });
  }
  if (place.startsWith("api.linkedin.com/rest/socialActions/")) {
    const sent = JSON.parse(await bodyText(init)) as { message?: { text?: string } };
    received.push({ network: "LinkedIn", what: "First comment", text: sent.message?.text, at: Date.now() });
    return json({}, { status: 201, headers: { "x-restli-id": `urn:li:comment:${nextId++}` } });
  }
  return null;
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const made = await answer(url, init);
  if (!made) return await realFetch(input, init);
  console.log(`[demo network] ${(init?.method ?? "GET").toUpperCase()} ${url.host}${url.pathname}`);
  return made;
};

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
}

const port = Number(process.env.DEMO_NETWORK_PORT ?? 0);
if (port) {
  createServer((_request, response) => {
    const rows = received
      .map(
        (item) =>
          `<li><b>${item.network}</b> <span>${escape(item.what)}</span>${
            item.text ? `<p>${escape(item.text).replace(/\n/g, "<br>")}</p>` : ""
          }</li>`,
      )
      .join("");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html>
<meta charset="utf-8"><title>What the networks received</title>
<style>
  body { font: 16px/1.5 system-ui; margin: 0; padding: 48px; background: #f4f1ea; color: #1c1a17 }
  h1 { font-size: 28px; margin: 0 0 4px } small { color: #6b655c }
  ul { list-style: none; padding: 0; margin: 24px 0 0; display: grid; gap: 12px; max-width: 760px }
  li { background: white; border-radius: 16px; padding: 16px 20px }
  b { display: inline-block; min-width: 88px } span { color: #6b655c } p { margin: 8px 0 0 }
</style>
<h1>What the networks received</h1>
<small>Stand-in X and LinkedIn servers for this walkthrough: nothing was really posted.</small>
<ul>${rows || "<li>Nothing yet.</li>"}</ul>`);
  }).listen(port, "127.0.0.1");
}
