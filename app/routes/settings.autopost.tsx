import { Form, Link } from "react-router";
import type { Route } from "./+types/settings.autopost";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { requireRecentAuth } from "~/.server/auth/twoFactor";
import { convex } from "~/.server/convex";
import { config } from "~/.server/config";
import { canConnect } from "~/.server/auth/oauth";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { MissingSecretKeyError } from "~/.server/crypto";
import { createBlueskySession, fetchXProfile, sealCredentials, SocialError } from "~/.server/social/adapters";
import type { XOwnCredentials } from "~/.server/social/x-credentials";
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
      ({ _id, provider, handle, displayName, avatarUrl, expiresAt, defaultMode, brand }) => ({
        id: _id,
        provider,
        handle,
        displayName,
        avatarUrl,
        expiresAt,
        defaultMode,
        brand: brand ?? "",
      }),
    ),
    xEnabled: config.x !== null,
    linkedinEnabled: config.linkedin !== null,
    // The studio's networks, offered only where this server has their app keys.
    connectable: {
      meta: canConnect("facebook"),
      threads: canConnect("threads"),
      tiktok: canConnect("tiktok"),
      youtube: canConnect("google"),
    },
  };
}

function isMode(value: string): value is CrosspostMode {
  return value === "post" || value === "amplify" || value === "off";
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
  // Connecting an account lets Slopper post as it: whoever does it proves it's them first.
  if (["x-own-app", "bluesky"].includes(formText(form, "intent"))) {
    await requireRecentAuth(context.get(viewerContext), request, HERE);
  }

  switch (formText(form, "intent")) {
    case "modes": {
      for (const account of await convex.query(api.accounts.list, { userId: user._id })) {
        const mode = formText(form, `mode-${account._id}`);
        if (isMode(mode) && mode !== account.defaultMode) {
          await convex.mutation(api.accounts.setDefaultMode, { userId: user._id, accountId: account._id, mode });
        }
        const brand = form.get(`brand-${account._id}`);
        if (typeof brand === "string" && brand.trim() !== (account.brand ?? "")) {
          await convex.mutation(api.accounts.setBrand, { userId: user._id, accountId: account._id, brand });
        }
      }
      return redirectWithFlash(HERE, { tone: "success", message: "Saved." });
    }

    case "disconnect": {
      await convex.mutation(api.accounts.disconnect, {
        userId: user._id,
        accountId: formText(form, "id"),
      });
      return redirectWithFlash(HERE, { tone: "info", message: "Disconnected." });
    }

    case "x-own-app": {
      const credentials: XOwnCredentials = {
        kind: "own-app",
        apiKey: formText(form, "apiKey"),
        apiSecret: formText(form, "apiSecret"),
        accessToken: formText(form, "accessToken"),
        accessTokenSecret: formText(form, "accessTokenSecret"),
      };
      if (
        [credentials.apiKey, credentials.apiSecret, credentials.accessToken, credentials.accessTokenSecret].some(
          (value) => !value || value.length > 2048 || /\s/.test(value),
        )
      ) {
        return redirectWithFlash(HERE, { tone: "error", message: "X needs all four credentials, with no spaces." });
      }
      try {
        // Seal first: don't send credentials anywhere when encrypted storage is unavailable.
        const sealedCredentials = await sealCredentials(credentials);
        const profile = await fetchXProfile(credentials);
        const account = await convex.mutation(api.accounts.connect, {
          userId: user._id,
          provider: "x",
          remoteId: profile.id,
          handle: profile.username,
          displayName: profile.name,
          avatarUrl: profile.profile_image_url ?? null,
          sealedCredentials,
          expiresAt: null,
          initialMode: "off",
        });
        return redirectWithFlash(HERE, {
          tone: "success",
          message: `Connected @${account.handle} on X using your developer app. Choose Post for this account on the products it represents.`,
        });
      } catch (error) {
        if (error instanceof MissingSecretKeyError) {
          return redirectWithFlash(HERE, { tone: "error", message: error.message });
        }
        // Never log or reflect supplied credentials, including an upstream error body.
        return redirectWithFlash(HERE, {
          tone: "error",
          message:
            "Couldn't connect X. Check your credentials, Read and write permissions, and API credits, then try again.",
        });
      }
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
          return redirectWithFlash(HERE, { tone: "error", message: error.message });
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

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Accounts", noindex: true });

export default function Autopost({ loaderData }: Route.ComponentProps) {
  const { accounts } = loaderData;
  return (
    <section className="mx-auto max-w-3xl px-4 pt-10">
      <SettingsNav />
      <h1 className="title-1 mt-10">Accounts</h1>
      <p className="lede mt-4 max-w-2xl">
        Connect every account you post as, on every network. Name the brand each one speaks for, and the{" "}
        <Link to="/studio" className="link">
          studio
        </Link>{" "}
        picks a brand’s accounts in one tap. Launches and updates auto-post too: give each app its own account to{" "}
        <strong className="text-ink">post</strong>, and let your personal one{" "}
        <strong className="text-ink">repost</strong>. Each slop can override these.
      </p>

      {accounts.length > 0 && (
        <Form method="post" className="mt-10 grid gap-3">
          <input type="hidden" name="intent" value="modes" />
          {accounts.map((account) => {
            const expired = account.expiresAt !== null && Date.parse(account.expiresAt) < Date.now();
            return (
              <div key={account.id} className="panel flex flex-wrap items-center gap-4 p-4">
                {account.avatarUrl ? (
                  <img src={account.avatarUrl} alt="" className="size-10 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid size-10 place-items-center rounded-full bg-raised font-display text-lg font-extrabold">
                    {NETWORK_LABELS[account.provider].slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{account.handle}</p>
                  <p className="text-sm text-muted">
                    {NETWORK_LABELS[account.provider]}
                    {account.expiresAt && (
                      <span className={expired ? "text-hot" : ""}>
                        {` · ${expired ? "expired, reconnect" : `until ${account.expiresAt.slice(0, 10)}`}`}
                      </span>
                    )}
                  </p>
                </div>
                <input
                  name={`brand-${account.id}`}
                  defaultValue={account.brand}
                  maxLength={40}
                  placeholder="Brand"
                  aria-label={`Brand for ${account.displayName || account.handle}`}
                  className="input min-h-9 w-32 py-1 text-sm"
                />
                <ModePicker name={`mode-${account.id}`} provider={account.provider} value={account.defaultMode} />
                <button type="submit" form={`disconnect-${account.id}`} className="btn btn-quiet btn-sm text-muted">
                  Disconnect
                </button>
              </div>
            );
          })}
          <button type="submit" className="btn btn-slop mt-2 justify-self-start">
            Save
          </button>
        </Form>
      )}
      {accounts.map((account) => (
        <Form key={account.id} id={`disconnect-${account.id}`} method="post" hidden>
          <input type="hidden" name="intent" value="disconnect" />
          <input type="hidden" name="id" value={account.id} />
        </Form>
      ))}

      <h2 className="title-2 mt-16">Connect</h2>
      <Form method="post" className="panel mt-5" data-no-replay data-no-capture>
        <input type="hidden" name="intent" value="x-own-app" />
        <h3 className="font-display text-[1.6rem] leading-none font-extrabold">X · use your own API credentials</h3>
        <p className="mt-2 text-[0.9375rem] text-muted">
          Connect each brand separately. X charges your developer app for verification, posts and reposts. We encrypt
          your credentials. New accounts start Off; choose Post on each product they represent in its edit page.
          Reconnecting the same account keeps its posting choices.
        </p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-[0.9375rem] text-muted">
          <li>
            Sign in as the brand in the{" "}
            <a href="https://console.x.com" target="_blank" rel="noopener" className="underline">
              X Developer Console
            </a>{" "}
            and create an app.
          </li>
          <li>Enable OAuth 1.0a with Read and write permissions in the app’s user authentication settings.</li>
          <li>
            Copy the API Key and API Key Secret, then generate the brand’s Access Token and Access Token Secret.
            Regenerate user tokens if you changed permissions.
          </li>
          <li>Add API credits and a spending limit in X. An app-only Bearer Token cannot post on your behalf.</li>
        </ol>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {(
            [
              ["apiKey", "API Key"],
              ["apiSecret", "API Key Secret"],
              ["accessToken", "Access Token"],
              ["accessTokenSecret", "Access Token Secret"],
            ] as const
          ).map(([name, label]) => (
            <label key={name} className="grid gap-1 text-sm font-bold">
              {label}
              <input
                name={name}
                type="password"
                className="input font-mono"
                required
                maxLength={2048}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ))}
        </div>
        <button type="submit" className="btn btn-slop mt-4">
          Connect X with my credentials
        </button>
        <p className="mt-3 text-sm text-muted">
          Connecting verifies the account without publishing a post. Disconnect here to remove the stored credentials;
          revoke the tokens in X to invalidate them.
        </p>
      </Form>
      {/* Only networks this server has keys for; the rest stay hidden rather than shown as broken. */}
      {(loaderData.xEnabled || loaderData.linkedinEnabled || Object.values(loaderData.connectable).some(Boolean)) && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {loaderData.connectable.meta && (
            <ConnectCard
              title="Facebook & Instagram"
              body="Pick the Pages to post as in Facebook’s window. Each Page’s linked Instagram professional account comes with it."
              href="/auth/facebook?intent=connect"
            />
          )}
          {loaderData.connectable.youtube && (
            <ConnectCard
              title="YouTube"
              body="Choose a channel (each brand account is its own). Uploads videos and Shorts, and reads channel analytics."
              href="/auth/google?intent=connect"
            />
          )}
          {loaderData.connectable.tiktok && (
            <ConnectCard
              title="TikTok"
              body="Posts videos to the account you sign in with. You choose who can see each one."
              href="/auth/tiktok?intent=connect"
            />
          )}
          {loaderData.connectable.threads && (
            <ConnectCard
              title="Threads"
              body="Posts words, pictures and videos to your Threads profile, and reads their stats."
              href="/auth/threads?intent=connect"
            />
          )}
          {loaderData.xEnabled && (
            <ConnectCard
              title="X · Slopper app"
              body="Connect through Slopper’s developer app. To use your own API credits, use the credentials form above."
              href="/auth/x?intent=connect"
            />
          )}
          {loaderData.linkedinEnabled && (
            <ConnectCard
              title="LinkedIn"
              body="Posts to your feed with a link card. LinkedIn needs a reconnect every 60 days."
              href="/auth/linkedin?intent=connect"
            />
          )}
        </div>
      )}

      <Form method="post" className="panel mt-4">
        <input type="hidden" name="intent" value="bluesky" />
        <h3 className="font-display text-[1.6rem] leading-none font-extrabold">Bluesky</h3>
        <p className="mt-2 text-[0.9375rem] text-muted">
          Use an{" "}
          <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener" className="underline">
            app password
          </a>
          , never your real one.
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
        <details className="mt-3 text-[0.9375rem] text-muted">
          <summary className="flex min-h-11 items-center hover:text-ink">Self-hosted PDS?</summary>
          <input
            name="service"
            type="url"
            className="input mt-2"
            placeholder="https://bsky.social"
            aria-label="PDS URL"
          />
        </details>
      </Form>

      <p className="mt-10 max-w-2xl text-muted">
        Accounts connected through Facebook, YouTube, TikTok and Threads start Off for launches, so a new brand never
        gets another product’s posts. The studio can post with them at once.{" "}
        <Link to="/rules" className="link">
          Rules
        </Link>{" "}
        apply to anything posted for you.
      </p>
    </section>
  );
}

function ConnectCard({ title, body, href }: { title: string; body: string; href: string }) {
  return (
    <div className="panel flex flex-col">
      <h3 className="font-display text-[1.6rem] leading-none font-extrabold">{title}</h3>
      <p className="mt-2 flex-1 text-[0.9375rem] text-muted">{body}</p>
      <a href={href} className="btn btn-ink btn-sm mt-4 self-start">
        Connect {title}
      </a>
    </div>
  );
}
