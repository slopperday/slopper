import { Form, Link } from "react-router";
import type { Route } from "./+types/settings.autopost";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { requireRecentAuth } from "~/.server/auth/twoFactor";
import { convex, convexMessage } from "~/.server/convex";
import { config } from "~/.server/config";
import { canConnect } from "~/.server/auth/oauth";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { MissingSecretKeyError } from "~/.server/crypto";
import { createBlueskySession, fetchXProfile, sealCredentials, SocialError } from "~/.server/social/adapters";
import { addRedditSubreddit, connectCommunityNetwork, connectWithOwnToken } from "~/.server/social/connect";
import type { XOwnCredentials } from "~/.server/social/x-credentials";
import { type CrosspostMode, NETWORK_LABELS } from "~/lib/model";
import { seo } from "~/lib/seo";
import { callbackPath, SETUP_GUIDES } from "~/lib/setupGuides";
import { ModePicker } from "~/components/Autopost";
import { SettingsNav } from "~/components/Shared";

const HERE = "/settings/autopost";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const [rawAccounts, organizations] = await Promise.all([
    convex.query(api.accounts.list, { userId: user._id }),
    convex.query(api.organizations.list, { userId: user._id }),
  ]);
  const orgById = new Map(organizations.map((org) => [String(org.id), org.name]));
  return {
    // Sealed credentials never leave the server.
    accounts: rawAccounts.map(
      ({ _id, provider, handle, displayName, avatarUrl, expiresAt, defaultMode, brand, organizationId, broken }) => ({
        broken: broken ?? null,
        id: _id,
        provider,
        handle,
        displayName,
        avatarUrl,
        expiresAt,
        defaultMode,
        brand: brand ?? "",
        organizationId: organizationId ? String(organizationId) : "",
        organizationName: organizationId ? (orgById.get(String(organizationId)) ?? null) : null,
      }),
    ),
    organizations: organizations.map((org) => ({
      id: String(org.id),
      name: org.name,
      slug: org.slug,
      role: org.role,
      members: org.members.map((member) => ({
        userId: String(member.userId),
        username: member.username,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        role: member.role,
      })),
    })),
    xEnabled: config.x !== null,
    linkedinEnabled: config.linkedin !== null,
    // The studio's networks, offered via OAuth when this server has their app keys, or with your own token.
    connectable: {
      meta: canConnect("facebook"),
      threads: canConnect("threads"),
      tiktok: canConnect("tiktok"),
      youtube: canConnect("google"),
      reddit: canConnect("reddit"),
    },
    origin: config.appUrl.origin,
  };
}

function isMode(value: string): value is CrosspostMode {
  return value === "post" || value === "amplify" || value === "off";
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
  const intent = formText(form, "intent");
  // Connecting an account lets Slopper post as it: whoever does it proves it's them first.
  if (["x-own-app", "bluesky", "own-token", "community", "reddit-subreddit"].includes(intent)) {
    await requireRecentAuth(context.get(viewerContext), request, HERE);
  }

  switch (intent) {
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
        if (form.has(`organization-${account._id}`)) {
          const orgId = formText(form, `organization-${account._id}`);
          const currentOrgId = account.organizationId ? String(account.organizationId) : "";
          if (orgId !== currentOrgId) {
            await convex.mutation(api.accounts.setOrganization, {
              userId: user._id,
              accountId: account._id,
              organizationId: orgId || null,
            });
          }
        }
      }
      return redirectWithFlash(HERE, { tone: "success", message: "Saved." });
    }

    case "org-create": {
      const name = formText(form, "name");
      try {
        await convex.mutation(api.organizations.create, {
          userId: user._id,
          name,
        });
        return redirectWithFlash(HERE, {
          tone: "success",
          message: `Created organisation ${name.trim()}. Assign shared social accounts or invite teammates below.`,
        });
      } catch (error) {
        return redirectWithFlash(HERE, {
          tone: "error",
          message: convexMessage(error) ?? "Couldn't create that organisation.",
        });
      }
    }

    case "org-add-member": {
      const username = formText(form, "username").replace(/^@/, "");
      try {
        const orgId = formText(form, "organizationId");
        const memberRole = formText(form, "role") === "admin" ? ("admin" as const) : ("member" as const);
        await convex.mutation(api.organizations.addMember, {
          actorId: user._id,
          organizationId: orgId,
          username,
          role: memberRole,
        });
        return redirectWithFlash(HERE, {
          tone: "success",
          message: `Added @${username} to the organisation.`,
        });
      } catch (error) {
        return redirectWithFlash(HERE, {
          tone: "error",
          message: convexMessage(error) ?? "Couldn't add that member.",
        });
      }
    }

    case "org-remove-member": {
      try {
        await convex.mutation(api.organizations.removeMember, {
          actorId: user._id,
          organizationId: formText(form, "organizationId"),
          memberUserId: formText(form, "memberUserId"),
        });
        return redirectWithFlash(HERE, { tone: "info", message: "Member removed." });
      } catch (error) {
        return redirectWithFlash(HERE, {
          tone: "error",
          message: convexMessage(error) ?? "Couldn't remove that member.",
        });
      }
    }

    case "org-delete": {
      try {
        await convex.mutation(api.organizations.remove, {
          actorId: user._id,
          organizationId: formText(form, "organizationId"),
        });
        return redirectWithFlash(HERE, { tone: "info", message: "Organisation deleted." });
      } catch (error) {
        return redirectWithFlash(HERE, {
          tone: "error",
          message: convexMessage(error) ?? "Couldn't delete that organisation.",
        });
      }
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
          brand: formText(form, "brand") || undefined,
          organizationId: formText(form, "organizationId") || undefined,
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
          brand: formText(form, "brand") || undefined,
          organizationId: formText(form, "organizationId") || undefined,
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

    case "own-token": {
      const network = formText(form, "network");
      const accessToken = formText(form, "accessToken");
      const refreshToken = formText(form, "refreshToken");
      if (!accessToken || accessToken.length > 4096 || /\s/.test(accessToken)) {
        return redirectWithFlash(HERE, { tone: "error", message: "Enter a valid access token with no spaces." });
      }
      try {
        const flash = await connectWithOwnToken(network, accessToken, refreshToken, user._id, {
          brand: formText(form, "brand"),
          organizationId: formText(form, "organizationId"),
        });
        return redirectWithFlash(HERE, flash);
      } catch (error) {
        if (error instanceof SocialError || error instanceof MissingSecretKeyError) {
          return redirectWithFlash(HERE, { tone: "error", message: error.message });
        }
        return redirectWithFlash(HERE, {
          tone: "error",
          message: "Couldn't verify that token. Check its scopes and try again.",
        });
      }
    }

    case "reddit-subreddit": {
      try {
        const flash = await addRedditSubreddit(user._id, formText(form, "accountId"), formText(form, "subreddit"));
        return redirectWithFlash(HERE, flash);
      } catch (error) {
        if (error instanceof SocialError) return redirectWithFlash(HERE, { tone: "error", message: error.message });
        throw error;
      }
    }

    case "community": {
      const network = formText(form, "network");
      if (network !== "mastodon" && network !== "discord" && network !== "telegram" && network !== "reddit") {
        return redirectWithFlash(HERE, { tone: "error", message: "Unknown network." });
      }
      try {
        const flash = await connectCommunityNetwork(
          network,
          {
            service: formText(form, "service"),
            accessToken: formText(form, "accessToken"),
            webhookUrl: formText(form, "webhookUrl"),
            botToken: formText(form, "botToken"),
            chatId: formText(form, "chatId"),
            subreddit: formText(form, "subreddit"),
            brand: formText(form, "brand"),
            organizationId: formText(form, "organizationId"),
          },
          user._id,
        );
        return redirectWithFlash(HERE, flash);
      } catch (error) {
        if (error instanceof SocialError || error instanceof MissingSecretKeyError) {
          return redirectWithFlash(HERE, { tone: "error", message: error.message });
        }
        return redirectWithFlash(HERE, {
          tone: "error",
          message: "Couldn't verify those credentials. Check the values and try again.",
        });
      }
    }

    default:
      return redirectWithFlash(HERE);
  }
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Accounts", noindex: true });

export default function Autopost({ loaderData }: Route.ComponentProps) {
  const { accounts, organizations } = loaderData;
  return (
    <section className="mx-auto max-w-3xl px-4 pt-10 pb-16">
      <SettingsNav />
      <h1 className="title-1 mt-10">Accounts &amp; Organisations</h1>
      <p className="lede mt-4 max-w-2xl">
        Connect as many accounts as you like on every network — personal profiles, product handles, community servers,
        and channels. Name the brand or assign an <strong className="text-ink">organisation</strong> so your whole team
        can post and repost from shared social accounts in the{" "}
        <Link to="/studio" className="link">
          studio
        </Link>
        .
      </p>

      {accounts.length > 0 && (
        <Form method="post" className="mt-10 grid gap-3">
          <input type="hidden" name="intent" value="modes" />
          {accounts.map((account) => {
            const expired = account.expiresAt !== null && Date.parse(account.expiresAt) < Date.now();
            return (
              <div key={account.id} className="panel flex flex-wrap items-center gap-3 p-4">
                {account.avatarUrl ? (
                  <img src={account.avatarUrl} alt="" className="size-10 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid size-10 place-items-center rounded-full bg-raised font-display text-lg font-extrabold">
                    {NETWORK_LABELS[account.provider].slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-bold">{account.displayName || account.handle}</p>
                    {account.organizationName && (
                      <span className="rounded-full bg-sunk px-2 py-0.5 text-xs font-bold">
                        Shared · {account.organizationName}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted">
                    {NETWORK_LABELS[account.provider]} · {account.handle}
                  </p>
                  <ConnectionHealth broken={account.broken} expiresAt={account.expiresAt} expired={expired} />
                </div>
                <input
                  name={`brand-${account.id}`}
                  defaultValue={account.brand}
                  maxLength={40}
                  placeholder="Brand"
                  aria-label={`Brand for ${account.displayName || account.handle}`}
                  className="input min-h-9 w-28 py-1 text-sm"
                />
                {organizations.length > 0 && (
                  <select
                    name={`organization-${account.id}`}
                    defaultValue={account.organizationId}
                    aria-label={`Organisation for ${account.displayName || account.handle}`}
                    className="input min-h-9 w-36 py-1 text-sm"
                  >
                    <option value="">Personal only</option>
                    {organizations.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name}
                      </option>
                    ))}
                  </select>
                )}
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

      {/* Organisations: shared social accounts across a team */}
      <h2 className="title-2 mt-16">Organisations</h2>
      <p className="mt-2 max-w-2xl text-[0.9375rem] text-muted">
        Create an organisation for your team or company. Any social account assigned to an organisation can be selected
        by its members in the Studio to publish, schedule, or repost together.
      </p>
      <Form method="post" className="panel mt-4 flex flex-wrap items-center gap-3">
        <input type="hidden" name="intent" value="org-create" />
        <input
          name="name"
          className="input min-w-56 flex-1"
          placeholder="Organisation name (e.g. Slopper Labs)"
          aria-label="Organisation name"
          maxLength={60}
          required
        />
        <button type="submit" className="btn btn-slop">
          Create organisation
        </button>
      </Form>

      {organizations.length > 0 && (
        <div className="mt-4 grid gap-4">
          {organizations.map((org) => {
            const sharedAccounts = accounts.filter((account) => account.organizationId === org.id);
            const canManage = org.role === "owner" || org.role === "admin";
            return (
              <div key={org.id} className="panel grid gap-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-[1.4rem] leading-none font-extrabold">{org.name}</h3>
                    <p className="mt-1 text-sm text-muted">
                      @{org.slug} · Your role: <strong className="text-ink">{org.role}</strong> ·{" "}
                      {sharedAccounts.length} shared social account{sharedAccounts.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  {org.role === "owner" && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="org-delete" />
                      <input type="hidden" name="organizationId" value={org.id} />
                      <button type="submit" className="btn btn-quiet btn-sm text-muted">
                        Delete organisation
                      </button>
                    </Form>
                  )}
                </div>

                {sharedAccounts.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {sharedAccounts.map((acc) => (
                      <span
                        key={acc.id}
                        className="inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1 text-xs font-bold"
                      >
                        {NETWORK_LABELS[acc.provider]} · {acc.displayName || acc.handle}
                      </span>
                    ))}
                  </div>
                )}

                <div className="grid gap-2">
                  <p className="text-xs font-bold tracking-wider text-muted uppercase">
                    Members ({org.members.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {org.members.map((member) => (
                      <span
                        key={member.userId}
                        className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-1.5 text-sm"
                      >
                        <span className="font-bold">@{member.username}</span>
                        <span className="text-xs text-muted">({member.role})</span>
                        {canManage && member.role !== "owner" && (
                          <Form method="post" className="inline">
                            <input type="hidden" name="intent" value="org-remove-member" />
                            <input type="hidden" name="organizationId" value={org.id} />
                            <input type="hidden" name="memberUserId" value={member.userId} />
                            <button
                              type="submit"
                              className="text-xs text-muted hover:text-hot"
                              aria-label={`Remove @${member.username}`}
                            >
                              ×
                            </button>
                          </Form>
                        )}
                      </span>
                    ))}
                  </div>
                </div>

                {canManage && (
                  <Form method="post" className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <input type="hidden" name="intent" value="org-add-member" />
                    <input type="hidden" name="organizationId" value={org.id} />
                    <input
                      name="username"
                      className="input min-h-9 flex-1 py-1 text-sm"
                      placeholder="Invite teammate by @username"
                      aria-label={`Add member to ${org.name}`}
                      required
                    />
                    <select name="role" className="input min-h-9 w-28 py-1 text-sm" aria-label="Member role">
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button type="submit" className="btn btn-ink btn-sm">
                      Add member
                    </button>
                  </Form>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h2 className="title-2 mt-16">Connect</h2>
      <p className="mt-2 max-w-2xl text-[0.9375rem] text-muted">
        You can connect multiple accounts on every network — just submit a form again with another handle, channel,
        webhook, or token.
      </p>

      <Form method="post" className="panel mt-5" data-no-replay data-no-capture>
        <input type="hidden" name="intent" value="x-own-app" />
        <h3 className="font-display text-[1.6rem] leading-none font-extrabold">X · use your own API credentials</h3>
        <p className="mt-2 text-[0.9375rem] text-muted">
          Connect each brand or personal handle separately. X charges your developer app for verification, posts and
          reposts. We encrypt your credentials. New accounts start Off; choose Post on each product they represent in
          its edit page.
        </p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-[0.9375rem] text-muted">
          <li>
            Sign in as the account in the{" "}
            <a href="https://console.x.com" target="_blank" rel="noopener" className="underline">
              X Developer Console
            </a>{" "}
            and create an app.
          </li>
          <li>Enable OAuth 1.0a with Read and write permissions in the app’s user authentication settings.</li>
          <li>
            Copy the API Key and API Key Secret, then generate the account’s Access Token and Access Token Secret.
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
        <ConnectAssignmentFields organizations={organizations} />
        <button type="submit" className="btn btn-slop mt-4">
          Connect X with my credentials
        </button>
        <p className="mt-3 text-sm text-muted">
          Connecting verifies the account without publishing a post. Disconnect here to remove the stored credentials;
          revoke the tokens in X to invalidate them.
        </p>
      </Form>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <ConnectCard
          title="Facebook & Instagram"
          body="Pick the Pages to post as in Facebook’s window. Each Page’s linked Instagram professional account comes with it."
          href="/auth/facebook?intent=connect"
          enabled={loaderData.connectable.meta}
          network="meta"
          tokenHint="Graph API User or Page access token (pages_manage_posts, instagram_content_publish)"
          organizations={organizations}
        />
        <ConnectCard
          title="YouTube"
          body="Choose a channel (each brand account is its own). Uploads videos and Shorts, and reads channel analytics."
          href="/auth/google?intent=connect"
          enabled={loaderData.connectable.youtube}
          network="youtube"
          tokenHint="OAuth access token (youtube.upload, youtube.readonly)"
          needsRefresh
          organizations={organizations}
        />
        <ConnectCard
          title="TikTok"
          body="Posts videos to the account you sign in with. Connect multiple accounts by signing in or supplying tokens for each handle."
          href="/auth/tiktok?intent=connect"
          enabled={loaderData.connectable.tiktok}
          network="tiktok"
          tokenHint="TikTok Content Posting API access token (video.publish)"
          needsRefresh
          organizations={organizations}
        />
        <ConnectCard
          title="Threads"
          body="Posts words, pictures and videos to your Threads profile, and reads their stats."
          href="/auth/threads?intent=connect"
          enabled={loaderData.connectable.threads}
          network="threads"
          tokenHint="Threads user access token (threads_basic, threads_content_publish)"
          organizations={organizations}
        />
        {loaderData.xEnabled && (
          <ConnectCard
            title="X · Slopper app"
            body="Connect through Slopper’s developer app. To use your own API credits, use the credentials form above."
            href="/auth/x?intent=connect"
            enabled
            organizations={organizations}
          />
        )}
        <ConnectCard
          title="LinkedIn"
          body="Posts to your feed with a link card, images, videos or PDFs. LinkedIn needs a reconnect every 60 days."
          href="/auth/linkedin?intent=connect"
          enabled={loaderData.linkedinEnabled}
          network="linkedin"
          tokenHint="LinkedIn OAuth access token (openid, profile, w_member_social)"
          organizations={organizations}
        />
      </div>

      <Form method="post" className="panel mt-4">
        <input type="hidden" name="intent" value="bluesky" />
        <h3 className="font-display text-[1.6rem] leading-none font-extrabold">Bluesky</h3>
        <p className="mt-2 text-[0.9375rem] text-muted">
          Use an{" "}
          <a href="https://bsky.app/settings/app-passwords" target="_blank" rel="noopener" className="underline">
            app password
          </a>
          , never your real one. Connect as many Bluesky handles as you run.
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
        <ConnectAssignmentFields organizations={organizations} />
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

      {/* Fediverse & Community Networks: Mastodon, Discord, Telegram, Reddit */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Form method="post" className="panel flex flex-col" data-no-replay data-no-capture>
          <input type="hidden" name="intent" value="community" />
          <input type="hidden" name="network" value="mastodon" />
          <h3 className="font-display text-[1.6rem] leading-none font-extrabold">Mastodon</h3>
          <p className="mt-2 flex-1 text-[0.9375rem] text-muted">
            Connect any Fediverse / Mastodon instance (mastodon.social, fosstodon.org, hachyderm.io, or your own
            server). Create an access token under Preferences → Development with{" "}
            <code className="font-mono text-xs">read:accounts</code> and{" "}
            <code className="font-mono text-xs">write:statuses</code>.
          </p>
          <div className="mt-3 grid gap-2">
            <input
              name="service"
              type="url"
              className="input min-h-9 py-1 text-sm"
              placeholder="https://mastodon.social"
              defaultValue="https://mastodon.social"
              aria-label="Mastodon instance URL"
              required
            />
            <input
              name="accessToken"
              type="password"
              className="input min-h-9 py-1 font-mono text-sm"
              placeholder="Mastodon access token"
              aria-label="Mastodon access token"
              required
              autoComplete="off"
            />
            <ConnectAssignmentFields organizations={organizations} compact />
            <button type="submit" className="btn btn-slop btn-sm mt-1 justify-self-start">
              Connect Mastodon
            </button>
          </div>
        </Form>

        <Form method="post" className="panel flex flex-col" data-no-replay data-no-capture>
          <input type="hidden" name="intent" value="community" />
          <input type="hidden" name="network" value="discord" />
          <h3 className="font-display text-[1.6rem] leading-none font-extrabold">Discord</h3>
          <p className="mt-2 flex-1 text-[0.9375rem] text-muted">
            Post announcements, media, and release notes into any Discord server channel. Connect multiple channels or
            servers by adding a webhook URL for each channel (Channel Settings → Integrations → Webhooks).
          </p>
          <div className="mt-3 grid gap-2">
            <input
              name="webhookUrl"
              type="password"
              className="input min-h-9 py-1 font-mono text-sm"
              placeholder="https://discord.com/api/webhooks/..."
              aria-label="Discord webhook URL"
              required
              autoComplete="off"
            />
            <ConnectAssignmentFields organizations={organizations} compact />
            <button type="submit" className="btn btn-slop btn-sm mt-1 justify-self-start">
              Connect Discord channel
            </button>
          </div>
        </Form>

        <Form method="post" className="panel flex flex-col" data-no-replay data-no-capture>
          <input type="hidden" name="intent" value="community" />
          <input type="hidden" name="network" value="telegram" />
          <h3 className="font-display text-[1.6rem] leading-none font-extrabold">Telegram</h3>
          <p className="mt-2 flex-1 text-[0.9375rem] text-muted">
            Broadcast posts, photos, and videos to Telegram channels or supergroups. Add your bot from{" "}
            <code className="font-mono text-xs">@BotFather</code> as an admin of the channel.
          </p>
          <div className="mt-3 grid gap-2">
            <input
              name="chatId"
              className="input min-h-9 py-1 text-sm"
              placeholder="@channelhandle or -100123456789"
              aria-label="Telegram channel handle or chat ID"
              required
            />
            <input
              name="botToken"
              type="password"
              className="input min-h-9 py-1 font-mono text-sm"
              placeholder="123456789:ABCdefGHIjklMNO..."
              aria-label="Telegram Bot token"
              required
              autoComplete="off"
            />
            <ConnectAssignmentFields organizations={organizations} compact />
            <button type="submit" className="btn btn-slop btn-sm mt-1 justify-self-start">
              Connect Telegram channel
            </button>
          </div>
        </Form>

        <Form method="post" className="panel flex flex-col" data-no-replay data-no-capture>
          <input type="hidden" name="intent" value="community" />
          <input type="hidden" name="network" value="reddit" />
          <h3 className="font-display text-[1.6rem] leading-none font-extrabold">Reddit</h3>
          <p className="mt-2 flex-1 text-[0.9375rem] text-muted">
            Share launches and changelogs to your profile, your own subreddit or maker communities. Each subreddit is
            its own destination.
          </p>
          {loaderData.connectable.reddit && (
            <a href="/auth/reddit?intent=connect" className="btn btn-ink btn-sm mt-3 self-start">
              Connect Reddit
            </a>
          )}
          <details className="mt-3 text-sm text-muted" open={!loaderData.connectable.reddit}>
            <summary className="cursor-pointer font-bold hover:text-ink">
              {loaderData.connectable.reddit ? "Use your own token instead" : "Connect with a token"}
            </summary>
            <div className="mt-3 grid gap-2">
              <input
                name="subreddit"
                className="input min-h-9 py-1 text-sm"
                placeholder="r/sideproject"
                aria-label="Subreddit"
                required
              />
              <input
                name="accessToken"
                type="password"
                className="input min-h-9 py-1 font-mono text-sm"
                placeholder="Reddit OAuth access token (submit, read)"
                aria-label="Reddit access token"
                required
                autoComplete="off"
              />
              <ConnectAssignmentFields organizations={organizations} compact />
              <button type="submit" className="btn btn-slop btn-sm mt-1 justify-self-start">
                Connect Subreddit
              </button>
              <p className="text-xs">A pasted token lasts an hour. Sign in with Reddit for posts that go out later.</p>
            </div>
          </details>
        </Form>
      </div>

      {accounts.some((account) => account.provider === "reddit") && (
        <Form method="post" className="panel mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" data-no-capture>
          <input type="hidden" name="intent" value="reddit-subreddit" />
          <h3 className="font-bold sm:col-span-3">Post into another subreddit</h3>
          <select name="accountId" className="input min-h-9 py-1 text-sm" aria-label="Reddit account">
            {accounts
              .filter((account) => account.provider === "reddit")
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.displayName}
                </option>
              ))}
          </select>
          <input
            name="subreddit"
            className="input min-h-9 py-1 text-sm"
            placeholder="r/sideproject"
            aria-label="Subreddit to add"
            required
          />
          <button type="submit" className="btn btn-ink btn-sm">
            Add subreddit
          </button>
          <p className="text-xs text-muted sm:col-span-3">
            Read its rules first: many subreddits limit self-promotion.
          </p>
        </Form>
      )}

      <SetupGuides origin={loaderData.origin} />

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

function ConnectAssignmentFields({
  organizations,
  compact = false,
}: {
  organizations: readonly { id: string; name: string }[];
  compact?: boolean;
}) {
  return (
    <div className={`${compact ? "mt-1" : "mt-3"} grid gap-2 sm:grid-cols-2`}>
      <input
        name="brand"
        maxLength={40}
        placeholder="Brand label (optional)"
        aria-label="Brand label"
        className="input min-h-9 py-1 text-sm"
      />
      {organizations.length > 0 && (
        <select
          name="organizationId"
          defaultValue=""
          aria-label="Share with organisation"
          className="input min-h-9 py-1 text-sm"
        >
          <option value="">Personal account</option>
          {organizations.map((org) => (
            <option key={org.id} value={org.id}>
              Share with {org.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function ConnectCard({
  title,
  body,
  href,
  enabled,
  network,
  tokenHint,
  needsRefresh,
  organizations,
}: {
  title: string;
  body: string;
  href: string;
  enabled: boolean;
  network?: string;
  tokenHint?: string;
  needsRefresh?: boolean;
  organizations: readonly { id: string; name: string }[];
}) {
  const tokenForm = network ? (
    <Form method="post" className="mt-3 grid gap-2" data-no-replay data-no-capture>
      <input type="hidden" name="intent" value="own-token" />
      <input type="hidden" name="network" value={network} />
      {tokenHint && <p className="text-xs text-muted">{tokenHint}</p>}
      <input
        name="accessToken"
        type="password"
        className="input min-h-9 py-1 font-mono text-sm"
        placeholder="Access token"
        aria-label={`${title} access token`}
        required
        maxLength={4096}
        autoComplete="off"
        spellCheck={false}
      />
      {needsRefresh && (
        <input
          name="refreshToken"
          type="password"
          className="input min-h-9 py-1 font-mono text-sm"
          placeholder="Refresh token (optional)"
          aria-label={`${title} refresh token`}
          maxLength={4096}
          autoComplete="off"
          spellCheck={false}
        />
      )}
      <ConnectAssignmentFields organizations={organizations} compact />
      <button type="submit" className="btn btn-slop btn-sm justify-self-start">
        Connect {title} with token
      </button>
    </Form>
  ) : null;
  return (
    <div className="panel flex flex-col">
      <h3 className="font-display text-[1.6rem] leading-none font-extrabold">{title}</h3>
      <p className="mt-2 flex-1 text-[0.9375rem] text-muted">{body}</p>
      {enabled ? (
        <>
          <a href={href} className="btn btn-ink btn-sm mt-4 self-start">
            Connect {title}
          </a>
          {tokenForm && (
            <details className="mt-3 text-sm text-muted">
              <summary className="cursor-pointer font-bold hover:text-ink">Use your own API token</summary>
              {tokenForm}
            </details>
          )}
        </>
      ) : (
        tokenForm
      )}
    </div>
  );
}

/** Whether an account can post: connected, expiring soon (reconnect before it stops), or needing a reconnect now. */
function ConnectionHealth({
  broken,
  expiresAt,
  expired,
}: {
  broken: string | null;
  expiresAt: string | null;
  expired: boolean;
}) {
  const days = expiresAt ? Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000) : null;
  if (broken) return <p className="text-sm font-bold text-hot">Needs reconnecting: {broken}</p>;
  if (expired) return <p className="text-sm font-bold text-hot">Expired: reconnect it to keep posting.</p>;
  if (days !== null && days <= 7) {
    return (
      <p className="text-sm font-bold text-hot">Expires in {days === 1 ? "a day" : `${days} days`}: reconnect soon.</p>
    );
  }
  return (
    <p className="text-sm text-slop-text">Connected{days !== null ? ` · until ${expiresAt!.slice(0, 10)}` : ""}</p>
  );
}

/** How to set up every network: the server's one-time app setup, and each person's steps. */
function SetupGuides({ origin }: { origin: string }) {
  return (
    <section className="mt-16" aria-labelledby="setup-guides">
      <h2 id="setup-guides" className="title-2">
        How to set up each network
      </h2>
      <p className="mt-2 max-w-2xl text-muted">
        “Once, on the server” is for whoever runs Slopper: a developer app and its keys, set in monosecret.toml then{" "}
        <code className="font-mono text-sm">vp run env:netlify</code>. “To connect” is for everyone.
      </p>
      <div className="mt-5 grid gap-2">
        {SETUP_GUIDES.map((guide) => (
          <details key={guide.network} className="panel">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 font-bold">
              {NETWORK_LABELS[guide.network]}
              <span className="text-sm font-normal text-muted">· {guide.method}</span>
            </summary>
            {guide.owner.length > 0 && (
              <>
                <h3 className="mt-4 text-sm font-bold">Once, on the server</h3>
                <ol className="mt-1 grid list-decimal gap-1 pl-5 text-sm">
                  {guide.owner.map((step) => (
                    <li key={step}>{step.replace("{callback}", `${origin}${callbackPath(guide.network)}`)}</li>
                  ))}
                </ol>
                {guide.env.length > 0 && (
                  <p className="mt-2 text-xs text-muted">
                    Variables:{" "}
                    {guide.env.map((name) => (
                      <code key={name} className="mr-1 font-mono">
                        {name}
                      </code>
                    ))}
                  </p>
                )}
              </>
            )}
            <h3 className="mt-4 text-sm font-bold">To connect</h3>
            <ol className="mt-1 grid list-decimal gap-1 pl-5 text-sm">
              {guide.you.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {guide.notes.length > 0 && (
              <ul className="mt-3 grid list-disc gap-1 pl-5 text-sm text-muted">
                {guide.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
          </details>
        ))}
      </div>
    </section>
  );
}
