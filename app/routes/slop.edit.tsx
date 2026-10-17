import { data, Form, Link } from "react-router";
import type { Route } from "./+types/slop.edit";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { requireUser, viewerContext } from "~/.server/session";
import { convex, convexMessage } from "~/.server/convex";
import { formText, parseSlopForm, slopFormValues } from "~/.server/forms";
import { forbidden, notFound, redirectWithFlash } from "~/.server/http";
import { deleteOrphanedMedia, screenshotsWithUrls } from "~/.server/media";
import { checkedContent, checkSlop } from "~/.server/moderation";
import { modeFor } from "~/.server/social/crosspost";
import { type CrosspostMode, NETWORK_LABELS } from "~/lib/model";
import { slopPath } from "~/lib/display";
import { editWindow } from "~/lib/editing";
import { seo } from "~/lib/seo";
import { SlopFields } from "~/components/SlopFields";
import { ModePicker } from "~/components/Autopost";
import { AgentPrompt } from "~/components/AgentPrompt";
import { Icon } from "~/components/Icon";
import { editPrompt } from "~/lib/prompts";

/** The caller's own slop, by `/@handle/slug`, or a 403/404. */
async function loadOwned(
  params: Route.LoaderArgs["params"],
  request: Request,
  context: Route.LoaderArgs["context"],
): Promise<{ user: Doc<"users">; slop: Doc<"slops"> }> {
  const user = requireUser(context.get(viewerContext), request);
  if (!params.handle.startsWith("@")) notFound();
  if (params.handle.slice(1).toLowerCase() !== user.username) forbidden();
  const slop = await convex.query(api.slops.findForServer, { userId: user._id, ref: params.slug });
  if (!slop) notFound();
  return { user, slop };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { user, slop } = await loadOwned(params, request, context);
  const accounts = await convex.query(api.accounts.list, { userId: user._id });
  return {
    username: user.username,
    editing: editWindow({ launchedAt: slop._creationTime, launchDate: slop.launchDate }, user.timeZone, Date.now()),
    slop: {
      id: slop._id,
      slug: slop.slug,
      name: slop.name,
      launchLabel: slop.launchLabel,
      values: {
        name: slop.name,
        tagline: slop.tagline,
        description: slop.description,
        category: slop.category,
        links: slop.links,
        screenshots: await screenshotsWithUrls(slop.screenshots),
        madeWith: slop.madeWith,
      },
    },
    accounts: accounts.map((account) => ({
      id: account._id,
      provider: account.provider,
      handle: account.handle,
      defaultMode: account.defaultMode,
      mode: modeFor(slop, account),
    })),
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { user, slop } = await loadOwned(params, request, context);
  const form = await request.formData();
  const here = slopPath(user.username, slop.slug);

  if (formText(form, "intent") === "autopost") {
    const modes: Record<string, CrosspostMode> = {};
    for (const account of await convex.query(api.accounts.list, { userId: user._id })) {
      const mode = formText(form, `mode-${account._id}`);
      if ((mode === "post" || mode === "amplify" || mode === "off") && mode !== account.defaultMode) {
        modes[account._id] = mode;
      }
    }
    await convex.mutation(api.slops.setCrosspost, { userId: user._id, slopId: slop._id, modes });
    return redirectWithFlash(`${here}/edit#autopost`, { tone: "success", message: "Auto-post saved for this slop." });
  }

  const parsed = parseSlopForm(form);
  if (!parsed.ok) {
    const values = slopFormValues(form);
    return data(
      { errors: parsed.errors, values: { ...values, screenshots: await screenshotsWithUrls(values.screenshots) } },
      { status: 422 },
    );
  }
  const { launchNote: _launchNote, ...input } = parsed.value;
  let edited: { blurred: boolean; orphaned: number };
  try {
    edited = await convex.mutation(api.slops.edit, { userId: user._id, slopId: slop._id, input });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return redirectWithFlash(`${here}/edit`, { tone: "error", message });
    throw error;
  }
  if (edited.orphaned > 0) await deleteOrphanedMedia();
  const saved = await convex.query(api.slops.getForServer, { slopId: slop._id });
  const check = saved && checkedContent(saved) !== checkedContent(slop) ? await checkSlop(slop._id) : null;
  if (check?.verdict === "blocked") {
    return redirectWithFlash(here, {
      tone: "error",
      message: "Saved, and waiting for a moderator.",
    });
  }
  return redirectWithFlash(here, {
    tone: "success",
    message: check?.verdict === "mature" || edited.blurred ? "Saved. It's marked NSFW now, so it's blurred." : "Saved.",
  });
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  seo(matches, { title: `Edit ${loaderData?.slop.name ?? "slop"}`, noindex: true });

export default function EditSlop({ loaderData, actionData }: Route.ComponentProps) {
  const { slop, username, accounts, editing } = loaderData;
  const path = slopPath(username, slop.slug);
  return (
    <section className="mx-auto max-w-3xl px-4 pt-10">
      <Link to={path} className="inline-flex min-h-11 items-center gap-1.5 font-bold text-muted hover:text-ink">
        <Icon name="left" className="size-4" /> {slop.name}
      </Link>
      <h1 className="title-1 mt-6">Edit {slop.name}</h1>
      {editing.open ? (
        <>
          <p className="lede mt-4">
            {editing.label}, then it's locked and news goes in updates. The launch date and number stay.
          </p>
          <div className="mt-10">
            <AgentPrompt prompt={(origin) => editPrompt(origin, slop.slug)} />
          </div>
          <Form method="post" className="mt-12 grid gap-8">
            <input type="hidden" name="intent" value="details" />
            <SlopFields values={actionData?.values ?? slop.values} errors={actionData?.errors ?? {}} />
            <button type="submit" className="btn btn-slop btn-lg justify-self-start">
              Save changes
            </button>
          </Form>
        </>
      ) : (
        <div className="panel mt-8 grid justify-items-start gap-4">
          <p className="text-[1.125rem]">
            <span className="font-bold">Locked.</span> Launches can be edited on their launch day and for at least 12
            hours. Post an update to share what's new.
          </p>
          <Link to={`${path}#updates`} className="btn btn-slop">
            Post an update
          </Link>
        </div>
      )}

      <section id="autopost" className="mt-20 scroll-mt-24 border-t border-line pt-12">
        <h2 className="title-2">Auto-post for {slop.name}</h2>
        <p className="mt-3 text-muted">Pick who posts it: its own account to post, your personal one to repost.</p>
        {accounts.length === 0 ? (
          <Link to="/settings/autopost" className="btn mt-5">
            Connect accounts first
          </Link>
        ) : (
          <Form method="post" className="mt-6 grid gap-3">
            <input type="hidden" name="intent" value="autopost" />
            {accounts.map((account) => (
              <div key={account.id} className="panel flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-bold">{account.handle}</p>
                  <p className="text-sm text-muted">
                    {NETWORK_LABELS[account.provider]} · default {account.defaultMode}
                  </p>
                </div>
                <ModePicker name={`mode-${account.id}`} provider={account.provider} value={account.mode} />
              </div>
            ))}
            <button type="submit" className="btn btn-slop justify-self-start">
              Save auto-post
            </button>
          </Form>
        )}
      </section>

      <section id="delete" className="mt-20 scroll-mt-24 rounded-2xl bg-hot-tint p-5 sm:p-6">
        <h2 className="font-display text-[1.75rem] leading-none font-extrabold text-hot">Scrape it off the wall</h2>
        <p className="mt-2 text-[0.9375rem]">
          Deletes the slop, its updates, feedback and votes. Type <code className="font-mono">{slop.slug}</code> to
          confirm.
        </p>
        <Form method="post" action={path} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="intent" value="delete" />
          <input name="confirm" className="input max-w-xs" aria-label="Type the slug to confirm" autoComplete="off" />
          <button type="submit" className="btn bg-hot text-hot-ink hover:bg-hot/85">
            Delete forever
          </button>
        </Form>
      </section>
    </section>
  );
}
