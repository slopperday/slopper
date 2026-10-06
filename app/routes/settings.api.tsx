import { data, Form } from "react-router";
import type { Route } from "./+types/settings.api";
import { getKv } from "~/.server/kv";
import { requireUser, viewerContext } from "~/.server/session";
import { createApiToken, listApiTokens, revokeApiToken } from "~/.server/db/tokens";
import { config } from "~/.server/config";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { formatDay } from "~/lib/dates";
import { seo } from "~/lib/seo";
import { CopyButton, SettingsNav } from "~/components/Shared";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  return { tokens: await listApiTokens(await getKv(), user.id), origin: config.appUrl.origin };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const kv = await getKv();
  const form = await request.formData();
  if (formText(form, "intent") === "revoke") {
    await revokeApiToken(kv, user.id, formText(form, "id"));
    return redirectWithFlash("/settings/api", { tone: "info", message: "Token revoked." });
  }
  const result = await createApiToken(kv, user.id, formText(form, "name"));
  if (!result.ok) return data({ token: null, error: result.error }, { status: 422 });
  return { token: result.token, error: null };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "API & MCP", noindex: true });

export default function ApiSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { tokens, origin } = loaderData;
  const token = actionData?.token ?? "<token>";
  const snippets = [
    {
      label: "Claude Code",
      code: `claude mcp add --transport http slopper ${origin}/mcp --header "Authorization: Bearer ${token}"`,
    },
    {
      label: "Cursor, Windsurf and other mcp.json clients",
      code: JSON.stringify(
        { mcpServers: { slopper: { url: `${origin}/mcp`, headers: { Authorization: `Bearer ${token}` } } } },
        null,
        2,
      ),
    },
    {
      label: "REST",
      code: `curl ${origin}/api/v1/me -H "Authorization: Bearer ${token}"`,
    },
  ];
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <SettingsNav />
      <h1 className="font-wide mt-6 text-4xl font-black">API & MCP</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Let your AI run Slopper for you: launch slops, post updates, log field tests, set goals. Create a token, add the
        MCP server to your agent, and paste the prompt from any form. Docs for agents live at{" "}
        <a href="/llms.txt" className="underline">
          /llms.txt
        </a>
        .
      </p>

      {actionData?.token && (
        <div className="mt-8 rounded-2xl border-2 border-ink bg-slop p-5 text-slop-ink">
          <p className="font-black">Your new token. Copy it now; it won't be shown again.</p>
          <code className="mt-3 block overflow-x-auto rounded-lg bg-wall p-3 font-mono text-sm text-ink">
            {actionData.token}
          </code>
          <div className="mt-3 max-w-48">
            <CopyButton value={actionData.token} label="Copy token" />
          </div>
        </div>
      )}
      {actionData?.error && (
        <p
          role="alert"
          className="mt-6 rounded-xl border-2 border-ink bg-hot px-4 py-3 text-sm font-semibold text-white"
        >
          {actionData.error}
        </p>
      )}

      <Form method="post" className="mt-8 flex flex-wrap gap-2">
        <input type="hidden" name="intent" value="create" />
        <input name="name" className="input max-w-xs" placeholder="Claude Code on my laptop" aria-label="Token name" />
        <button type="submit" className="btn btn-slop">
          Create token
        </button>
      </Form>

      {tokens.length > 0 && (
        <ul className="mt-6 grid gap-2">
          {tokens.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-ink bg-card px-4 py-3"
            >
              <span>
                <span className="block font-bold">{item.name}</span>
                <span className="block font-mono text-[0.68rem] text-muted">
                  {item.preview}… · created {formatDay(item.createdAt.slice(0, 10))}
                  {item.lastUsedAt ? ` · last used ${formatDay(item.lastUsedAt.slice(0, 10))}` : " · never used"}
                </span>
              </span>
              <Form method="post">
                <input type="hidden" name="intent" value="revoke" />
                <input type="hidden" name="id" value={item.id} />
                <button type="submit" className="btn btn-quiet btn-sm text-muted">
                  Revoke
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}

      <h2 className="font-wide mt-14 text-2xl font-black">Connect your agent</h2>
      <div className="mt-5 grid gap-5">
        {snippets.map((snippet) => (
          <div key={snippet.label}>
            <p className="field-label">{snippet.label}</p>
            <pre className="overflow-x-auto rounded-xl border-2 border-ink bg-card p-4 font-mono text-xs leading-relaxed">
              {snippet.code}
            </pre>
            <div className="mt-2 max-w-40">
              <CopyButton value={snippet.code} label="Copy" />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-10 text-sm text-muted">
        Tools: whoami, list_categories, set_goal, upload_screenshot, create_slop, update_slop, post_update,
        mark_slopcessful, list_my_slops, todays_race. Social accounts are connected in the browser (they need your
        approval on each network); after that, agents can auto-post.
      </p>
    </section>
  );
}
