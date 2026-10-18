import { data, Form } from "react-router";
import type { Route } from "./+types/settings";
import { api } from "@convex/_generated/api";
import { requireUser, type User, viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { config } from "~/.server/config";
import { formText, parseWebUrl } from "~/.server/forms";
import { badRequest, redirectWithFlash } from "~/.server/http";
import { normalizeUsername } from "~/lib/username";
import { isOAuthProvider, LIMITS, OAUTH_LABELS, OAUTH_PROVIDERS, type OAuthProviderId } from "~/lib/model";
import { seo } from "~/lib/seo";
import { Field } from "~/components/SlopFields";
import { SettingsNav } from "~/components/Shared";
import { ProviderIcon } from "~/components/ProviderIcon";
import { AnalyticsChoice } from "~/components/AnalyticsChoice";
import { MotionChoice } from "~/components/MotionChoice";
import { BrowserNotifications } from "~/components/BrowserNotifications";

const HERE = "/settings";

/** A provider that's set up here, or linked already (then it can still be unlinked). */
interface SignInMethod {
  provider: OAuthProviderId;
  linked: boolean;
  /** Has keys on this server, so it can sign in. */
  available: boolean;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const identities = await convex.query(api.users.identities, { userId: user._id });
  const linked = new Set(identities);
  const methods: SignInMethod[] = OAUTH_PROVIDERS.filter(
    (provider) => linked.has(provider) || config[provider] !== null,
  ).map((provider) => ({ provider, linked: linked.has(provider), available: config[provider] !== null }));
  return {
    // What the form edits, and nothing else: the record also holds the digest's unsubscribe token.
    user: {
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      website: user.website,
      timeZone: user.timeZone,
      showNsfw: user.showNsfw,
    },
    timeZones: Intl.supportedValuesOf("timeZone"),
    methods,
    // Every identity counts, the local dev login included: the last one stays.
    canUnlink: identities.length > 1,
    vapidPublicKey: config.vapidPublicKey,
    digest: { address: user.email ?? null, enabled: user.emailDigest !== false },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
  switch (formText(form, "intent")) {
    case "profile":
      return await saveProfile(user, form);
    case "unlink":
      return await unlink(user, formText(form, "provider"));
    case "digest": {
      const enabled = formText(form, "enabled") === "on";
      await convex.mutation(api.users.setEmailDigest, { userId: user._id, enabled });
      return redirectWithFlash(`${HERE}#email-digest`, {
        tone: "success",
        message: enabled ? "Daily digest on." : "Daily digest off.",
      });
    }
    default:
      badRequest("Unknown action");
  }
}

async function saveProfile(user: User, form: FormData) {
  const websiteText = formText(form, "website");
  const website = websiteText ? parseWebUrl(websiteText) : null;
  if (websiteText && !website) return data({ error: "That website isn't a URL." }, { status: 422 });
  const result = await convex.mutation(api.users.updateProfile, {
    userId: user._id,
    username: normalizeUsername(formText(form, "username")),
    displayName: formText(form, "displayName"),
    bio: formText(form, "bio"),
    website: website?.href ?? null,
    timeZone: formText(form, "timeZone"),
    showNsfw: form.get("showNsfw") === "on",
  });
  if (!result.ok) return data({ error: result.error }, { status: 422 });
  return redirectWithFlash(HERE, { tone: "success", message: "Saved." });
}

async function unlink(user: User, provider: string): Promise<Response> {
  if (!isOAuthProvider(provider)) badRequest("Unknown sign-in method");
  const label = OAUTH_LABELS[provider];
  const result = await convex.mutation(api.users.unlinkIdentity, { userId: user._id, provider });
  if (result.ok) {
    return redirectWithFlash(HERE, { tone: "info", message: `Unlinked ${label}.` });
  }
  return redirectWithFlash(HERE, {
    tone: "error",
    message:
      result.reason === "last_method" ? `${label} is your only way in. Link another first.` : `${label} isn't linked.`,
  });
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Settings", noindex: true });

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { user, timeZones, methods, canUnlink, vapidPublicKey, digest } = loaderData;
  return (
    <section className="mx-auto max-w-2xl px-4 pt-10">
      <SettingsNav />
      <h1 className="title-1 mt-10">Settings</h1>
      {actionData?.error && (
        <p role="alert" className="mt-6 rounded-xl bg-hot px-4 py-3 font-bold text-hot-ink">
          {actionData.error}
        </p>
      )}
      <Form method="post" className="mt-10 grid gap-7">
        <input type="hidden" name="intent" value="profile" />
        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="username" label="Username" hint="Your page: slopper.day/@username.">
            <input
              id="username"
              name="username"
              className="input font-mono"
              required
              defaultValue={user.username}
              maxLength={30}
            />
          </Field>
          <Field id="displayName" label="Display name">
            <input
              id="displayName"
              name="displayName"
              className="input"
              defaultValue={user.displayName}
              maxLength={60}
            />
          </Field>
        </div>
        <Field id="bio" label="Bio" hint={`Up to ${LIMITS.bioLength} characters.`}>
          <textarea
            id="bio"
            name="bio"
            className="input min-h-24"
            maxLength={LIMITS.bioLength}
            defaultValue={user.bio}
          />
        </Field>
        <Field id="website" label="Website">
          <input
            id="website"
            name="website"
            type="url"
            className="input"
            defaultValue={user.website ?? ""}
            placeholder="https://"
          />
        </Field>
        <Field id="timeZone" label="Time zone" hint="Your day ends at midnight here.">
          <select id="timeZone" name="timeZone" className="input" defaultValue={user.timeZone}>
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
            {!timeZones.includes(user.timeZone) && <option value={user.timeZone}>{user.timeZone}</option>}
          </select>
        </Field>
        <label className="panel flex cursor-pointer items-start gap-3">
          <input type="checkbox" name="showNsfw" defaultChecked={user.showNsfw} className="mt-1 size-5" />
          <span>
            <span className="font-bold">Show NSFW slops</span>
            <span className="block text-[0.9375rem] text-muted">Shows them in feeds without the blur.</span>
          </span>
        </label>
        <button type="submit" className="btn btn-slop btn-lg justify-self-start">
          Save
        </button>
      </Form>
      <EmailDigest {...digest} />
      {vapidPublicKey && <BrowserNotifications vapidPublicKey={vapidPublicKey} />}
      <MotionChoice />
      <AnalyticsChoice />
      {methods.length > 0 && <SignInMethods methods={methods} canUnlink={canUnlink} />}
    </section>
  );
}

function EmailDigest({ address, enabled }: { address: string | null; enabled: boolean }) {
  return (
    <section id="email-digest" className="mt-16 scroll-mt-24" aria-labelledby="email-digest-title">
      <h2 id="email-digest-title" className="title-2">
        Daily digest
      </h2>
      {address ? (
        <>
          <p className="mt-2 text-muted">
            One email at 9am your time, on days your slops got upvotes, pledges or a win. Sent to{" "}
            <span className="font-bold text-ink">{address}</span>.
          </p>
          <Form method="post" className="mt-6 flex flex-wrap items-center gap-4">
            <input type="hidden" name="intent" value="digest" />
            <input type="hidden" name="enabled" value={enabled ? "off" : "on"} />
            <button type="submit" className={`btn btn-sm ${enabled ? "btn-quiet" : "btn-ink"}`}>
              {enabled ? "Turn off" : "Turn on"}
            </button>
            <span className="text-sm text-muted">{enabled ? "On" : "Off"}</span>
          </Form>
        </>
      ) : (
        <p className="mt-2 text-muted">
          None of your sign-in methods shares a verified email. Link Google, GitHub, LinkedIn or Facebook below to get
          it.
        </p>
      )}
    </section>
  );
}

function SignInMethods({ methods, canUnlink }: { methods: SignInMethod[]; canUnlink: boolean }) {
  return (
    <section id="sign-in" className="mt-16 scroll-mt-24" aria-labelledby="sign-in-title">
      <h2 id="sign-in-title" className="title-2">
        Sign-in methods
      </h2>
      <p className="mt-2 text-muted">Any of these signs you in to this account.</p>
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {methods.map(({ provider, linked, available }) => {
          const label = OAUTH_LABELS[provider];
          return (
            <li key={provider} className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <ProviderIcon provider={provider} className="size-5" />
              <div className="min-w-0 flex-1">
                <p className="font-bold">{label}</p>
                <p className="text-sm text-muted">
                  {linked ? "Linked" : "Not linked"}
                  {!available && " · not available right now"}
                </p>
              </div>
              {linked ? (
                canUnlink ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="unlink" />
                    <input type="hidden" name="provider" value={provider} />
                    <button type="submit" className="btn btn-quiet btn-sm text-muted">
                      Unlink<span className="sr-only"> {label}</span>
                    </button>
                  </Form>
                ) : (
                  <span className="text-sm text-muted">Your only way in</span>
                )
              ) : (
                <a href={`/auth/${provider}?intent=link`} className="btn btn-ink btn-sm">
                  Link<span className="sr-only"> {label}</span>
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
