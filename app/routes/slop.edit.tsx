import { data, Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/slop.edit";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { requireUser, viewerContext } from "~/.server/session";
import { convex, convexMessage } from "~/.server/convex";
import { formText, parseSlopForm, slopFormValues, slopValues } from "~/.server/forms";
import { forbidden, notFound, redirectWithFlash } from "~/.server/http";
import { deleteOrphanedMedia, publicationForForm, screenshotsWithUrls } from "~/.server/media";
import { checkedContent, checkSlop } from "~/.server/moderation";
import { config } from "~/.server/config";
import { draftProductPage, readWebsite } from "~/.server/draft";
import { availableProviders, connectSource, parseConnect } from "~/.server/integrations";
import { INTEGRATIONS, isIntegrationProvider } from "~/lib/integrations";
import { Sources } from "~/components/Sources";
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
  const [accounts, sources, tags] = await Promise.all([
    convex.query(api.accounts.list, { userId: user._id }),
    convex.query(api.integrations.listForOwner, { userId: user._id, slopId: slop._id }),
    convex.query(api.tags.popular, {}),
  ]);
  return {
    username: user.username,
    editing: editWindow({ launchedAt: slop._creationTime, launchDate: slop.launchDate }, user.timeZone, Date.now()),
    sources,
    tags,
    available: availableProviders(),
    serviceAccount: config.googleAnalytics?.clientEmail ?? null,
    canDraft: config.contentCheck !== null,
    slop: {
      id: slop._id,
      slug: slop.slug,
      name: slop.name,
      launchLabel: slop.launchLabel,
      values: {
        ...slopValues(slop),
        screenshots: await screenshotsWithUrls(user._id, slop.screenshots),
        publication: await publicationForForm(user._id, slop.publication),
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

  const intent = formText(form, "intent");
  if (intent === "connect" || intent === "disconnect" || intent === "source-visibility") {
    return await sourceAction(intent, user, slop, form, `${here}/edit#traction`);
  }

  if (intent === "autopost") {
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

  // The draft button submits the form as typed, so the model reads the latest words.
  if (form.getAll("intent").includes("draft")) return await draft(user, form);

  const parsed = parseSlopForm(form);
  if (!parsed.ok) {
    const values = slopFormValues(form);
    return data(
      {
        errors: parsed.errors,
        values: {
          ...values,
          screenshots: await screenshotsWithUrls(user._id, values.screenshots),
          publication: await publicationForForm(user._id, values.publication),
        },
      },
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
  const needsCheck =
    saved && (!saved.check || saved.publishAfterCheck !== undefined || checkedContent(saved) !== checkedContent(slop));
  const check = needsCheck ? await checkSlop(slop._id) : null;
  if (needsCheck && !check) {
    return redirectWithFlash(here, {
      tone: "error",
      message: "Saved and waiting for a content check. Only you can see it.",
    });
  }
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

/** Connects, shows or hides, or disconnects a traction source. */
async function sourceAction(
  intent: "connect" | "disconnect" | "source-visibility",
  user: Doc<"users">,
  slop: Doc<"slops">,
  form: FormData,
  back: string,
) {
  try {
    if (intent === "disconnect") {
      await convex.mutation(api.integrations.disconnect, { userId: user._id, integrationId: formText(form, "id") });
      return redirectWithFlash(back, { tone: "info", message: "Disconnected. Its numbers are gone from the page." });
    }
    if (intent === "source-visibility") {
      const visible = formText(form, "public") === "on";
      await convex.mutation(api.integrations.setPublic, {
        userId: user._id,
        integrationId: formText(form, "id"),
        public: visible,
      });
      return redirectWithFlash(back, {
        tone: "info",
        message: visible ? "Everyone sees those numbers now." : "Only you see those numbers now.",
      });
    }
    const provider = formText(form, "provider");
    if (!isIntegrationProvider(provider) || !availableProviders().includes(provider)) {
      return redirectWithFlash(back, { tone: "error", message: "That source isn't available." });
    }
    if (!(await convex.mutation(api.limits.hit, { key: `connect:${user._id}`, limit: 30, windowMs: 3_600_000 }))) {
      return redirectWithFlash(back, { tone: "error", message: "Slow down a little. Try again later." });
    }
    const parsed = parseConnect(provider, form);
    const connected = parsed.ok
      ? await connectSource(user._id, slop._id, provider, parsed.value, form.get("public") === "on")
      : parsed;
    if (!connected.ok) {
      return data({ sourceError: { provider, message: connected.error } }, { status: 422 });
    }
    return redirectWithFlash(back, {
      tone: "success",
      message: `${INTEGRATIONS[provider].label} is connected. The numbers are on the slop page.`,
    });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return redirectWithFlash(back, { tone: "error", message });
    throw error;
  }
}

/** Fills the form with an AI draft of the product page. Nothing is saved until the maker saves. */
async function draft(user: Doc<"users">, form: FormData) {
  const values = slopFormValues(form);
  const echo = {
    ...values,
    screenshots: await screenshotsWithUrls(user._id, values.screenshots),
    publication: await publicationForForm(user._id, values.publication),
  };
  const failed = (notice: string) => data({ errors: {}, values: echo, notice, drafted: null }, { status: 422 });
  if (!config.contentCheck) return failed("AI drafts aren't set up on this server.");
  if (!(await convex.mutation(api.limits.hit, { key: `draft:${user._id}`, limit: 20, windowMs: 86_400_000 }))) {
    return failed("That's a lot of drafts today. Try again tomorrow.");
  }
  const website = values.links.find((link) => link.kind === "website")?.url;
  try {
    const drafted = await draftProductPage(
      {
        name: values.name,
        tagline: values.tagline,
        description: values.description,
        links: values.links.map((link) => link.url).filter(Boolean),
        madeWith: values.madeWith,
        features: values.features.filter((feature) => feature.title || feature.body),
        audience: values.audience,
      },
      website ? await readWebsite(website) : null,
      config.contentCheck,
    );
    return data({
      errors: {},
      values: { ...echo, ...drafted },
      notice: "Drafted. Read it over and make it yours, then save.",
      drafted: Date.now(),
    });
  } catch (error) {
    console.error("Product page draft failed", error);
    return failed("The draft didn't work this time. Try again in a minute.");
  }
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  seo(matches, { title: `Edit ${loaderData?.slop.name ?? "slop"}`, noindex: true });

export default function EditSlop({ loaderData, actionData }: Route.ComponentProps) {
  const { slop, username, accounts, editing, canDraft, sources, tags, available, serviceAccount } = loaderData;
  const path = slopPath(username, slop.slug);
  const navigation = useNavigation();
  const drafting = navigation.state === "submitting" && navigation.formData?.getAll("intent").includes("draft");
  const notice = actionData && "notice" in actionData ? actionData.notice : null;
  const sourceError = actionData && "sourceError" in actionData ? actionData.sourceError : null;
  const formData = actionData && "values" in actionData ? actionData : null;
  const drafted = actionData && "drafted" in actionData ? actionData.drafted : null;
  return (
    <section data-no-replay className="mx-auto max-w-3xl px-4 pt-10">
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
          {/* A new draft remounts the fields, so they show it instead of what was typed before. */}
          <Form key={drafted ?? "form"} method="post" className="mt-12 grid gap-8">
            <input type="hidden" name="intent" value="details" />
            <SlopFields values={formData?.values ?? slop.values} errors={formData?.errors ?? {}} tags={tags} />
            {notice && (
              <p role="status" className="rounded-xl bg-sunk px-4 py-3 font-bold">
                {notice}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {/* Save comes first, so Enter in a field saves rather than drafts. */}
              <button type="submit" className="btn btn-slop btn-lg">
                Save changes
              </button>
              {canDraft && (
                <button
                  type="submit"
                  name="intent"
                  value="draft"
                  formNoValidate
                  className="btn btn-lg"
                  disabled={drafting}
                >
                  <Icon name="spark" className="size-5" />
                  {drafting ? "Drafting…" : "Draft the product page with AI"}
                </button>
              )}
            </div>
          </Form>
        </>
      ) : (
        <div className="panel mt-8 grid justify-items-start gap-4">
          <p className="text-[1.125rem]">
            <span className="font-bold">Locked.</span> Launches can be edited until the end of the day after launch, at
            least 24 hours after they go out. Post an update to share what's new.
          </p>
          <Link to={`${path}#updates`} className="btn btn-slop">
            Post an update
          </Link>
        </div>
      )}

      <Sources
        name={slop.name}
        sources={sources}
        available={available}
        serviceAccount={serviceAccount}
        error={sourceError}
      />

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
