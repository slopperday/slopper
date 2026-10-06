import { Form, Link } from "react-router";
import type { Route } from "./+types/settings.autopost";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { config } from "~/.server/config";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { MissingSecretKeyError } from "~/.server/crypto";
import { createBlueskySession, sealCredentials, SocialError } from "~/.server/social/adapters";
import { type CrosspostMode, NETWORK_LABELS } from "~/lib/model";
import { seo } from "~/lib/seo";
import { ModePicker } from "~/components/Autopost";
import { SettingsNav } from "~/components/Shared";

const HERE = "/settings/autopost";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  return {
    // Sealed credentials never leave the server.
    accounts: (await convex.query(api.accounts.list, { userId: user._id })).map(
      ({ _id, provider, handle, avatarUrl, expiresAt, defaultMode }) => ({
        id: _id,
        provider,
        handle,
        avatarUrl,
        expiresAt,
        defaultMode,
      }),
    ),
    xEnabled: config.x !== null,
    linkedinEnabled: config.linkedin !== null,
  };
}

function isMode(value: string): value is CrosspostMode {
  return value === "post" || value === "amplify" || value === "off";
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();

  switch (formText(form, "intent")) {
    case "modes": {
      for (const account of await convex.query(api.accounts.list, { userId: user._id })) {
        const mode = formText(form, `mode-${account._id}`);
        if (isMode(mode) && mode !== account.defaultMode) {
          await convex.mutation(api.accounts.setDefaultMode, { userId: user._id, accountId: account._id, mode });
        }
      }
      return redirectWithFlash(HERE, { tone: "success", message: "Defaults saved." });
    }

    case "disconnect": {
      await convex.mutation(api.accounts.disconnect, {
        userId: user._id,
        accountId: formText(form, "id"),
      });
      return redirectWithFlash(HERE, { tone: "info", message: "Disconnected." });
    }

    case "bluesky": {
      const identifier = formText(form, "identifier").replace(/^@/, "");
      const appPassword = formText(form, "appPassword");
      const service = formText(form, "service") || "https://bsky.social";
      if (!identifier || !appPassword) {
        return redirectWithFlash(HERE, { tone: "error", message: "Bluesky needs your handle and an app password." });
      }
      try {
        const credentials = { service, identifier, appPassword };
        const session = await createBlueskySession(credentials);
        const account = await convex.mutation(api.accounts.connect, {
          userId: user._id,
          provider: "bluesky",
          remoteId: session.did,
          handle: session.handle,
          displayName: session.handle,
          avatarUrl: null,
          sealedCredentials: await sealCredentials(credentials),
          expiresAt: null,
        });
        return redirectWithFlash(HERE, { tone: "success", message: `Connected @${account.handle} on Bluesky.` });
      } catch (error) {
        if (error instanceof SocialError) {
          return redirectWithFlash(HERE, { tone: "error", message: "Bluesky rejected that handle or app password." });
        }
        if (error instanceof MissingSecretKeyError) {
          return redirectWithFlash(HERE, { tone: "error", message: error.message });
        }
        throw error;
      }
    }

    default:
      return redirectWithFlash(HERE);
  }
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Auto-post", noindex: true });

export default function Autopost({ loaderData }: Route.ComponentProps) {
  const { accounts } = loaderData;
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <SettingsNav />
      <h1 className="font-wide mt-6 text-4xl font-black">Auto-post</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Connected accounts post your launches and updates for you. Connect as many X accounts as you like: give each app
        its own account to <strong className="text-ink">post</strong>, and let your personal account{" "}
        <strong className="text-ink">repost</strong>. Each slop can override these defaults.
      </p>

      {accounts.length > 0 && (
        <Form method="post" className="mt-8 grid gap-3">
          <input type="hidden" name="intent" value="modes" />
          {accounts.map((account) => {
            const expired = account.expiresAt !== null && Date.parse(account.expiresAt) < Date.now();
            return (
              <div
                key={account.id}
                className="flex flex-wrap items-center gap-4 rounded-xl border-2 border-ink bg-card p-4"
              >
                {account.avatarUrl ? (
                  <img
                    src={account.avatarUrl}
                    alt=""
                    className="size-10 rounded-full border-2 border-ink"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="grid size-10 place-items-center rounded-full border-2 border-ink bg-wall-deep font-display">
                    {NETWORK_LABELS[account.provider].slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{account.handle}</p>
                  <p className="font-mono text-[0.68rem] tracking-wider text-muted uppercase">
                    {NETWORK_LABELS[account.provider]}
                    {account.expiresAt && (
                      <span className={expired ? "text-hot" : ""}>
                        {` · ${expired ? "expired, reconnect" : `until ${account.expiresAt.slice(0, 10)}`}`}
                      </span>
                    )}
                  </p>
                </div>
                <ModePicker name={`mode-${account.id}`} provider={account.provider} value={account.defaultMode} />
                <button type="submit" form={`disconnect-${account.id}`} className="btn btn-quiet btn-sm text-muted">
                  Disconnect
                </button>
              </div>
            );
          })}
          <button type="submit" className="btn btn-slop justify-self-start">
            Save defaults
          </button>
        </Form>
      )}
      {accounts.map((account) => (
        <Form key={account.id} id={`disconnect-${account.id}`} method="post" hidden>
          <input type="hidden" name="intent" value="disconnect" />
          <input type="hidden" name="id" value={account.id} />
        </Form>
      ))}

      <h2 className="font-wide mt-14 text-2xl font-black">Connect</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <ConnectCard
          title="X"
          body="Post launches and updates. To add another account, switch accounts on x.com first, then connect again. X charges per post, billed to whoever runs this Slopper."
          href={loaderData.xEnabled ? "/auth/x" : null}
        />
        <ConnectCard
          title="LinkedIn"
          body="Post to your feed with a link card. LinkedIn makes everyone reconnect every 60 days."
          href={loaderData.linkedinEnabled ? "/auth/linkedin" : null}
        />
      </div>

      <Form method="post" className="mt-4 rounded-2xl border-2 border-ink bg-card p-5">
        <input type="hidden" name="intent" value="bluesky" />
        <h3 className="font-black">Bluesky</h3>
        <p className="mt-1 text-sm text-muted">
          Use an{" "}
          <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener" className="underline">
            app password
          </a>
          , never your real one. It's encrypted before it's stored.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input
            name="identifier"
            className="input"
            placeholder="you.bsky.social"
            aria-label="Bluesky handle"
            required
          />
          <input
            name="appPassword"
            type="password"
            className="input font-mono"
            placeholder="xxxx-xxxx-xxxx-xxxx"
            aria-label="App password"
            required
            autoComplete="off"
          />
          <button type="submit" className="btn btn-slop">
            Connect
          </button>
        </div>
        <details className="mt-3 text-sm text-muted">
          <summary className="cursor-pointer">Self-hosted PDS?</summary>
          <input
            name="service"
            type="url"
            className="input mt-2"
            placeholder="https://bsky.social"
            aria-label="PDS URL"
          />
        </details>
      </Form>

      <p className="mt-10 rounded-xl border-2 border-dashed border-ink/40 p-4 text-sm text-muted">
        TikTok, Instagram, Threads and YouTube Shorts are next. They need app reviews before they'll post publicly.
        Until then every slop page has one-tap share buttons.{" "}
        <Link to="/rules" className="underline">
          Rules
        </Link>{" "}
        apply to anything posted for you.
      </p>
    </section>
  );
}

function ConnectCard({ title, body, href }: { title: string; body: string; href: string | null }) {
  return (
    <div className="flex flex-col rounded-2xl border-2 border-ink bg-card p-5">
      <h3 className="font-black">{title}</h3>
      <p className="mt-1 flex-1 text-sm text-muted">{body}</p>
      {href ? (
        <a href={href} className="btn btn-sm mt-4 self-start">
          Connect {title}
        </a>
      ) : (
        <p className="mt-4 font-mono text-[0.68rem] tracking-wider text-muted uppercase">Not set up on this server</p>
      )}
    </div>
  );
}
