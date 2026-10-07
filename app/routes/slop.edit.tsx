import { data, Form, Link } from "react-router";
import type { Route } from "./+types/slop.edit";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { requireUser, viewerContext } from "~/.server/session";
import { convex, convexMessage } from "~/.server/convex";
import { formText, parseSlopForm, slopFormValues } from "~/.server/forms";
import { forbidden, notFound, redirectWithFlash } from "~/.server/http";
import { screenshotsWithUrls } from "~/.server/media";
import { checkedContent, checkSlop } from "~/.server/moderation";
import { modeFor } from "~/.server/social/crosspost";
import { type CrosspostMode, NETWORK_LABELS } from "~/lib/model";
import { slopPath } from "~/lib/display";
import { seo } from "~/lib/seo";
import { SlopFields } from "~/components/SlopFields";
import { ModePicker } from "~/components/Autopost";
import { AgentPrompt } from "~/components/AgentPrompt";
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
  try {
    await convex.mutation(api.slops.edit, { userId: user._id, slopId: slop._id, input });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return redirectWithFlash(`${here}/edit`, { tone: "error", message });
    throw error;
  }
  const saved = await convex.query(api.slops.getForServer, { slopId: slop._id });
  const check = saved && checkedContent(saved) !== checkedContent(slop) ? await checkSlop(slop._id) : null;
  if (check?.verdict === "blocked") {
    return redirectWithFlash(here, {
      tone: "error",
      message: "Saved, and held for review. A moderator will look at it.",
    });
  }
  return redirectWithFlash(here, {
    tone: "success",
    message: check?.verdict === "mature" ? "Saved. It's marked NSFW now, so it's blurred." : "Saved.",
  });
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  seo(matches, { title: `Edit ${loaderData?.slop.name ?? "slop"}`, noindex: true });

export default function EditSlop({ loaderData, actionData }: Route.ComponentProps) {
  const { slop, username, accounts } = loaderData;
  const path = slopPath(username, slop.slug);
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <Link to={path} className="eyebrow hover:text-ink">
        ← {slop.name}
      </Link>
      <h1 className="font-wide mt-2 text-4xl font-black">Edit {slop.name}</h1>
      <p className="mt-2 text-muted">The launch date and slop number stay put. Everything else is fair game.</p>
      <div className="mt-8">
        <AgentPrompt prompt={(origin) => editPrompt(origin, slop.slug)} />
      </div>
      <Form method="post" className="mt-10 grid gap-8">
        <input type="hidden" name="intent" value="details" />
        <SlopFields values={actionData?.values ?? slop.values} errors={actionData?.errors ?? {}} />
        <button type="submit" className="btn btn-slop justify-self-start">
          Save changes
        </button>
      </Form>

      <section id="autopost" className="mt-16 scroll-mt-24">
        <h2 className="font-wide text-2xl font-black">Auto-post for {slop.name}</h2>
        <p className="mt-2 text-muted">
          Choose who speaks for this slop. Give it its own X account to post, and let your personal account repost it.
        </p>
        {accounts.length === 0 ? (
          <Link to="/settings/autopost" className="btn mt-5">
            Connect accounts first
          </Link>
        ) : (
          <Form method="post" className="mt-6 grid gap-3">
            <input type="hidden" name="intent" value="autopost" />
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-ink bg-card p-4"
              >
                <div>
                  <p className="font-bold">{account.handle}</p>
                  <p className="font-mono text-[0.68rem] tracking-wider text-muted uppercase">
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

      <section id="delete" className="mt-16 scroll-mt-24 rounded-2xl border-2 border-hot p-5">
        <h2 className="text-lg font-black text-hot">Scrape it off the wall</h2>
        <p className="mt-1 text-sm text-muted">
          Deletes the slop, its updates, feedback and votes. Type <code className="font-mono">{slop.slug}</code> to
          confirm.
        </p>
        <Form method="post" action={path} className="mt-3 flex flex-wrap gap-2">
          <input type="hidden" name="intent" value="delete" />
          <input name="confirm" className="input max-w-xs" aria-label="Type the slug to confirm" autoComplete="off" />
          <button type="submit" className="btn btn-sm">
            Delete forever
          </button>
        </Form>
      </section>
    </section>
  );
}
