import { data, Form } from "react-router";
import type { Route } from "./+types/settings";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { formText, parseWebUrl } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { normalizeUsername } from "~/lib/username";
import { LIMITS } from "~/lib/model";
import { seo } from "~/lib/seo";
import { Field } from "~/components/SlopFields";
import { SettingsNav } from "~/components/Shared";

export function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  return { user, timeZones: Intl.supportedValuesOf("timeZone") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
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
  return redirectWithFlash("/settings", { tone: "success", message: "Saved." });
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Settings", noindex: true });

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { user, timeZones } = loaderData;
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
        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="username" label="Username" hint="Your page lives at slopper.day/@username.">
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
        <Field
          id="timeZone"
          label="Time zone"
          hint="Your day ends at midnight here. It decides which day a slop counts for."
        >
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
            <span className="block text-[0.9375rem] text-muted">
              Off by default. When on, NSFW slops show in feeds without the blur.
            </span>
          </span>
        </label>
        <button type="submit" className="btn btn-slop btn-lg justify-self-start">
          Save
        </button>
      </Form>
    </section>
  );
}
