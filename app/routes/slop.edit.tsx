import { data, Form, Link } from "react-router";
import type { Route } from "./+types/slop.edit";
import { getKv } from "~/.server/kv";
import { requireUser, viewerContext } from "~/.server/session";
import { resolveSlop } from "~/.server/routing";
import { editSlop, setCrosspostModes } from "~/.server/db/slops";
import { listAccounts } from "~/.server/db/accounts";
import { ownedMediaIds } from "~/.server/db/media";
import { formText, parseSlopForm, slopFormValues } from "~/.server/forms";
import { forbidden, redirectWithFlash } from "~/.server/http";
import { invalidateFeeds } from "~/.server/memo";
import { modeFor } from "~/.server/social/crosspost";
import { type CrosspostMode, NETWORK_LABELS, publicAccount, publicSlop } from "~/lib/model";
import { slopPath } from "~/lib/display";
import { seo } from "~/lib/seo";
import { SlopFields } from "~/components/SlopFields";
import { ModePicker } from "~/components/Autopost";
import { AgentPrompt } from "~/components/AgentPrompt";
import { editPrompt } from "~/lib/prompts";

async function loadOwned(params: Route.LoaderArgs["params"], request: Request, context: Route.LoaderArgs["context"]) {
  const viewer = context.get(viewerContext);
  const user = requireUser(viewer, request);
  const kv = await getKv();
  const { owner, slop } = await resolveSlop(kv, params, viewer);
  if (owner.id !== user.id) forbidden();
  return { kv, owner, slop };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { kv, owner, slop } = await loadOwned(params, request, context);
  const accounts = await listAccounts(kv, owner.id);
  return {
    username: owner.username,
    slop: publicSlop(slop),
    accounts: accounts.map((account) => ({ ...publicAccount(account), mode: modeFor(slop, account) })),
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const { kv, owner, slop } = await loadOwned(params, request, context);
  const form = await request.formData();
  const here = slopPath(owner.username, slop.slug);

  if (formText(form, "intent") === "autopost") {
    const modes: Record<string, CrosspostMode> = {};
    for (const account of await listAccounts(kv, owner.id)) {
      const mode = formText(form, `mode-${account.id}`);
      if ((mode === "post" || mode === "amplify" || mode === "off") && mode !== account.defaultMode) {
        modes[account.id] = mode;
      }
    }
    await setCrosspostModes(kv, slop.id, modes);
    return redirectWithFlash(`${here}/edit#autopost`, { tone: "success", message: "Auto-post saved for this slop." });
  }

  const parsed = parseSlopForm(form);
  if (!parsed.ok) return data({ errors: parsed.errors, values: slopFormValues(form) }, { status: 422 });
  const { launchNote: _launchNote, ...input } = parsed.value;
  input.screenshots = await ownedMediaIds(kv, owner.id, input.screenshots, slop.screenshots);
  await editSlop(kv, slop.id, input);
  invalidateFeeds();
  return redirectWithFlash(here, { tone: "success", message: "Saved." });
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
        <SlopFields values={actionData?.values ?? slop} errors={actionData?.errors ?? {}} />
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
