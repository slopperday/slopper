import { useState } from "react";
import { data, Form } from "react-router";
import type { Route } from "./+types/settings.api";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex, convexMessage } from "~/.server/convex";
import { createApiToken } from "~/.server/tokens";
import { config } from "~/.server/config";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { timeAgo } from "~/lib/dates";
import { seo } from "~/lib/seo";
import { CopyButton, CopyIconButton, SettingsNav } from "~/components/Shared";
import { Icon } from "~/components/Icon";

/** Keeps the "slp_" prefix so people can tell what it is, and hides the rest. */
function maskToken(token: string): string {
  return `${token.slice(0, 4)}${"•".repeat(24)}`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  return { tokens: await convex.query(api.tokens.list, { userId: user._id }), origin: config.appUrl.origin };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
  if (formText(form, "intent") === "revoke") {
    await convex.mutation(api.tokens.revoke, { userId: user._id, tokenId: formText(form, "id") });
    return redirectWithFlash("/settings/api", { tone: "info", message: "Token revoked." });
  }
  try {
    return { token: await createApiToken(user._id, formText(form, "name")), error: null };
  } catch (error) {
    const message = convexMessage(error);
    if (message) return data({ token: null, error: message }, { status: 422 });
    throw error;
  }
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "API & MCP", noindex: true });

export default function ApiSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { tokens, origin } = loaderData;
  const newToken = actionData?.token ?? null;
  // A new token stays hidden until asked for, in case the screen is being shared or streamed.
  // Revealing is per token: the next one made starts hidden again.
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const revealed = newToken !== null && revealedToken === newToken;
  const snippetsFor = (token: string) => [
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
      label: "CLI, for agents with a terminal",
      // The CLI talks to slopper.day unless told otherwise.
      code: `npx @slopperday/cli login --token ${token}${origin === "https://slopper.day" ? "" : ` --url ${origin}`}`,
    },
    {
      label: "REST",
      code: `curl ${origin}/api/v1/me -H "Authorization: Bearer ${token}"`,
    },
  ];
  // What's copied always holds the real token; what's shown holds it only once revealed.
  const copied = snippetsFor(newToken ?? "<token>");
  const shown = snippetsFor(newToken && !revealed ? maskToken(newToken) : (newToken ?? "<token>"));
  return (
    <section className="mx-auto max-w-3xl px-4 pt-10">
      <SettingsNav />
      <h1 className="title-1 mt-10">API & MCP</h1>
      <p className="lede mt-4 max-w-2xl">
        Let your AI run Slopper for you: launch slops, post updates, log field tests, set goals. Create a token, add the
        MCP server to your agent, and paste the prompt from any form. Docs for agents live at{" "}
        <a href="/llms.txt" className="link">
          /llms.txt
        </a>
        .
      </p>

      {newToken && (
        <div className="panel mt-8">
          <p className="font-bold">Your new token. Copy it now; it won't be shown again.</p>
          <div className="mt-3 flex items-center gap-1 rounded-xl bg-raised py-1.5 pr-1.5 pl-3">
            <code
              className="min-w-0 flex-1 overflow-x-auto font-mono text-sm whitespace-nowrap"
              data-testid="new-token"
            >
              {revealed ? newToken : maskToken(newToken)}
            </code>
            <button
              type="button"
              className="btn btn-quiet btn-sm px-2.5"
              aria-label={revealed ? "Hide token" : "Reveal token"}
              title={revealed ? "Hide token" : "Reveal token"}
              aria-pressed={revealed}
              onClick={() => setRevealedToken(revealed ? null : newToken)}
            >
              <Icon name={revealed ? "eyeOff" : "eye"} className="size-5" />
            </button>
            <CopyIconButton value={newToken} label="Copy token" />
          </div>
        </div>
      )}
      {actionData?.error && (
        <p role="alert" className="mt-6 rounded-xl bg-hot px-4 py-3 font-bold text-hot-ink">
          {actionData.error}
        </p>
      )}

      <Form method="post" className="mt-10 flex flex-wrap gap-2">
        <input type="hidden" name="intent" value="create" />
        <input name="name" className="input max-w-xs" placeholder="Claude Code on my laptop" aria-label="Token name" />
        <button type="submit" className="btn btn-slop">
          Create token
        </button>
      </Form>

      {tokens.length > 0 && (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {tokens.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span>
                <span className="block font-bold">{item.name}</span>
                <span className="block text-sm text-muted">
                  {item.preview}… · created {timeAgo(item.createdAt)}
                  {item.lastUsedAt ? ` · last used ${timeAgo(item.lastUsedAt)}` : " · never used"}
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

      <h2 className="title-2 mt-16">Connect your agent</h2>
      <div className="mt-6 grid gap-7">
        {shown.map((snippet, index) => (
          <div key={snippet.label} className="min-w-0">
            <p className="field-label">{snippet.label}</p>
            <pre className="overflow-x-auto rounded-xl bg-sunk p-4 font-mono text-[0.8125rem] leading-relaxed">
              {snippet.code}
            </pre>
            <div className="mt-2 max-w-40">
              <CopyButton value={copied[index].code} label="Copy" />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-12 text-muted">
        Tools: whoami, list_categories, set_goal, upload_screenshot, create_slop, update_slop, post_update, log_money,
        list_my_slops, list_scheduled, release_scheduled, cancel_scheduled, todays_race, vote. Social accounts are
        connected in the browser (they need your approval on each network); after that, agents can auto-post.
      </p>
    </section>
  );
}
