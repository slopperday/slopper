import { Form, Link } from "react-router";
import type { Route } from "./+types/studio.settings";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { requireRecentAuth } from "~/.server/auth/twoFactor";
import { absoluteUrl } from "~/.server/config";
import { convex, convexMessage } from "~/.server/convex";
import { formText, parseWebUrl } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { addFeed, importCsv, type ImportResult } from "~/.server/social/automation";
import { CSV_ROWS } from "~/lib/csv";
import { allowAction } from "~/.server/tokens";
import { VARIABLES } from "~/lib/variables";
import { NETWORK_LABELS } from "~/lib/networks";
import { seo } from "~/lib/seo";
import { CopyButton } from "~/components/Shared";
import { Icon } from "~/components/Icon";
import { AccountAvatar, type StudioAccount, StudioNav } from "~/components/Studio";

const HERE = "/studio/settings";
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SNIPPET_KINDS = {
  hashtags: "Hashtag group",
  signature: "Signature",
  template: "Template",
  reply: "Saved reply",
} as const;

function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const [settings, snippets, brands, feeds, accounts] = await Promise.all([
    convex.query(api.studio.settings, { userId: user._id }),
    convex.query(api.studio.snippets, { userId: user._id }),
    convex.query(api.studio.brands, { userId: user._id }),
    convex.query(api.studio.feeds, { userId: user._id }),
    convex.query(api.accounts.list, { userId: user._id }),
  ]);
  const brandNames = [...new Set(accounts.map((account) => account.brand).filter((name): name is string => !!name))];
  return {
    settings: {
      paused: settings.paused,
      slots: settings.slots,
      calendarUrl: settings.calendarToken ? absoluteUrl(`/api/studio/calendar/${settings.calendarToken}.ics`) : null,
      webhook: settings.webhook,
    },
    workflows: settings.workflows.map((workflow) => ({ ...workflow, accountIds: workflow.accountIds.map(String) })),
    defaultWorkflowId: settings.defaultWorkflowId,
    snippets,
    brands: brandNames.map((name) => ({ name, voice: brands.find((brand) => brand.name === name)?.voice ?? "" })),
    feeds,
    accounts: accounts.map(({ _id, provider, handle, displayName, avatarUrl, brand }): StudioAccount => ({
      id: _id,
      provider,
      handle,
      displayName,
      avatarUrl,
      brand: brand ?? null,
    })),
    timeZone: user.timeZone,
    bookmarklet: `javascript:location.href='${absoluteUrl("/studio")}?text='+encodeURIComponent(document.title)+'&link='+encodeURIComponent(location.href)`,
  };
}

/** "9:00, 12:30 17:00" into minutes after midnight. */
function parseTimes(value: string): number[] | null {
  const times: number[] = [];
  for (const part of value.split(/[\s,]+/).filter(Boolean)) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(part);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    times.push(Number(match[1]) * 60 + Number(match[2]));
  }
  return [...new Set(times)].sort((a, b) => a - b);
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
  const userId = user._id;
  const intent = formText(form, "intent");
  // These send posts or data somewhere on their own: whoever sets them proves it's them first.
  if (["feed", "webhook", "calendar-create", "csv"].includes(intent)) {
    await requireRecentAuth(context.get(viewerContext), request, HERE);
  }
  try {
    switch (intent) {
      case "queue": {
        const slots = [];
        for (const [day, name] of DAYS.entries()) {
          const times = parseTimes(formText(form, `day-${day}`));
          if (!times)
            return redirectWithFlash(HERE, { tone: "error", message: `${name}: write times like 09:00, 12:30.` });
          slots.push(...times.map((minute) => ({ day, minute })));
        }
        await convex.mutation(api.studio.saveSettings, { userId, slots });
        return redirectWithFlash(HERE, { tone: "success", message: "Queue saved." });
      }
      case "pause":
      case "resume":
        await convex.mutation(api.studio.saveSettings, { userId, paused: intent === "pause" });
        return redirectWithFlash(HERE, {
          tone: "info",
          message:
            intent === "pause"
              ? "Paused. Nothing goes out until you resume."
              : "Resumed. Anything that came due goes out now.",
        });
      case "snippet": {
        const kind = formText(form, "kind");
        if (!Object.hasOwn(SNIPPET_KINDS, kind)) return redirectWithFlash(HERE);
        await convex.mutation(api.studio.saveSnippet, {
          userId,
          kind: kind as keyof typeof SNIPPET_KINDS,
          name: formText(form, "name"),
          text: formText(form, "text"),
          autoAdd: form.get("autoAdd") === "on",
        });
        return redirectWithFlash(HERE, { tone: "success", message: "Saved." });
      }
      case "workflow-default":
        await convex.mutation(api.studio.chooseDefaultWorkflow, { userId, id: formText(form, "id") || null });
        return redirectWithFlash(HERE, {
          tone: "success",
          message: formText(form, "id")
            ? "New posts start with that workflow."
            : "New posts start with the accounts you used last.",
        });
      case "workflow-delete":
        await convex.mutation(api.studio.removeWorkflow, { userId, id: formText(form, "id") });
        return redirectWithFlash(HERE, { tone: "info", message: "Workflow deleted." });
      case "snippet-delete":
        await convex.mutation(api.studio.deleteSnippet, { userId, id: formText(form, "id") });
        return redirectWithFlash(HERE, { tone: "info", message: "Deleted." });
      case "voice":
        await convex.mutation(api.studio.saveBrandVoice, {
          userId,
          name: formText(form, "brand"),
          voice: formText(form, "voice"),
        });
        return redirectWithFlash(HERE, { tone: "success", message: "Brand voice saved." });
      case "feed": {
        if (!(await allowAction(`studio-feed:${userId}`, 20, 3_600_000))) {
          return redirectWithFlash(HERE, { tone: "error", message: "Slow down a little." });
        }
        const problem = await addFeed(user, {
          url: formText(form, "url"),
          accountIds: form.getAll("accounts").map(String),
          template: formText(form, "template"),
          mode: formText(form, "mode") === "now" ? "now" : "queue",
        });
        return redirectWithFlash(
          HERE,
          problem
            ? { tone: "error", message: problem }
            : { tone: "success", message: "Feed added. New items will be posted from now on." },
        );
      }
      case "feed-toggle":
      case "feed-remove":
        await convex.mutation(api.studio.setFeed, {
          userId,
          id: formText(form, "id"),
          ...(intent === "feed-remove" ? { remove: true } : { active: formText(form, "active") === "true" }),
        });
        return redirectWithFlash(HERE);
      case "csv": {
        const file = form.get("file");
        const csv = file instanceof File && file.size > 0 ? await file.text() : formText(form, "csv");
        if (csv.length > 500_000) return { results: [] as ImportResult[], error: "That file is too big." };
        const imported = await importCsv(user, csv, form.getAll("accounts").map(String));
        return { results: imported.results, error: imported.error };
      }
      case "webhook": {
        const raw = formText(form, "url");
        if (!raw) {
          await convex.mutation(api.studio.saveSettings, { userId, webhookUrl: null });
          return redirectWithFlash(HERE, { tone: "info", message: "Webhook removed." });
        }
        const url = parseWebUrl(raw);
        if (!url || url.protocol !== "https:")
          return redirectWithFlash(HERE, { tone: "error", message: "Webhooks go to an https:// address." });
        await convex.mutation(api.studio.saveSettings, { userId, webhookUrl: url.href });
        return redirectWithFlash(HERE, { tone: "success", message: "Webhook saved." });
      }
      case "calendar-create":
      case "calendar-revoke":
        await convex.mutation(api.studio.saveSettings, {
          userId,
          calendar: intent === "calendar-create" ? "create" : "revoke",
        });
        return redirectWithFlash(HERE, {
          tone: "info",
          message:
            intent === "calendar-create"
              ? "Calendar address made. Add it to your calendar app."
              : "That calendar address no longer works.",
        });
    }
  } catch (error) {
    const message = convexMessage(error);
    if (message) return redirectWithFlash(HERE, { tone: "error", message });
    throw error;
  }
  return redirectWithFlash(HERE);
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Studio settings", noindex: true });

function AccountPicker({ accounts, name }: { accounts: readonly StudioAccount[]; name: string }) {
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="mb-2 text-sm font-bold">Post as</legend>
      {accounts.map((account) => (
        <label
          key={account.id}
          className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-line px-2 py-1 text-sm has-checked:border-ink has-checked:bg-raised"
        >
          <input type="checkbox" name={name} value={account.id} className="sr-only" />
          <AccountAvatar account={account} size={24} />
          {account.displayName} · {NETWORK_LABELS[account.provider]}
        </label>
      ))}
    </fieldset>
  );
}

export default function StudioSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { settings, snippets, brands, feeds, accounts, timeZone, bookmarklet, workflows, defaultWorkflowId } =
    loaderData;
  const byDay = DAYS.map((_, day) =>
    settings.slots
      .filter((slot) => slot.day === day)
      .map((slot) => clock(slot.minute))
      .join(", "),
  );
  return (
    <section className="mx-auto max-w-4xl px-4 pt-10 pb-16">
      <h1 className="title-1">Studio</h1>
      <div className="mt-8">
        <StudioNav />
      </div>

      <div
        className={`panel mt-8 flex flex-wrap items-center justify-between gap-4 ${settings.paused ? "border-2 border-hot" : ""}`}
      >
        <div>
          <h2 className="title-3">{settings.paused ? "Paused" : "Posting is on"}</h2>
          <p className="mt-1 text-muted">
            {settings.paused
              ? "Nothing scheduled goes out until you resume. What came due goes out then."
              : "Pause everything at once, when the news isn't right for scheduled posts."}
          </p>
        </div>
        <Form method="post">
          <input type="hidden" name="intent" value={settings.paused ? "resume" : "pause"} />
          <button type="submit" className={settings.paused ? "btn btn-slop" : "btn btn-ink"}>
            {settings.paused ? "Resume posting" : "Pause all posts"}
          </button>
        </Form>
      </div>

      <div className="panel mt-6">
        <h2 className="title-3">Workflows</h2>
        <p className="mt-1 text-muted">
          The ways you usually post: which accounts, now or the queue, and what it’s about. New posts start with the
          starred one, or with the accounts you used last.
        </p>
        {workflows.length === 0 ? (
          <p className="mt-4 rounded-xl bg-ground p-4 text-sm">
            None yet. In the{" "}
            <Link to="/studio" className="font-bold underline">
              composer
            </Link>
            , pick the accounts and choose “Save as a workflow”.
          </p>
        ) : (
          <ul className="mt-4 grid gap-2" aria-label="Workflows">
            {workflows.map((workflow) => {
              const starred = workflow.id === defaultWorkflowId;
              const members = accounts.filter((account) => workflow.accountIds.includes(account.id));
              return (
                <li key={workflow.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-ground p-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-bold">
                      {starred && <Icon name="star" filled className="size-4 text-gold" />}
                      {workflow.name}
                    </p>
                    <p className="text-sm text-muted">
                      {members.length} account{members.length === 1 ? "" : "s"} ·{" "}
                      {workflow.when === "queue" ? "adds to the queue" : "posts straight away"}
                      {workflow.trackLinks ? " · tracks clicks" : ""}
                    </p>
                  </div>
                  <span className="flex -space-x-1.5">
                    {members.slice(0, 8).map((account) => (
                      <AccountAvatar key={account.id} account={account} size={26} />
                    ))}
                  </span>
                  <Form method="post">
                    <input type="hidden" name="intent" value="workflow-default" />
                    <input type="hidden" name="id" value={starred ? "" : workflow.id} />
                    <button type="submit" className="btn btn-quiet btn-sm">
                      {starred ? "Don’t start with it" : "Start new posts with it"}
                    </button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="workflow-delete" />
                    <input type="hidden" name="id" value={workflow.id} />
                    <button type="submit" className="btn btn-quiet btn-sm" aria-label={`Delete ${workflow.name}`}>
                      Delete
                    </button>
                  </Form>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Form method="post" className="panel mt-6">
        <input type="hidden" name="intent" value="queue" />
        <h2 className="title-3">Queue times</h2>
        <p className="mt-1 text-muted">
          “Add to queue” in the composer takes the next of these times that’s free, in your time zone ({timeZone}).
        </p>
        <div className="mt-4 grid gap-2">
          {DAYS.map((name, day) => (
            <label key={name} className="grid items-center gap-2 sm:grid-cols-[8rem_1fr]">
              <span className="font-bold">{name}</span>
              <input
                name={`day-${day}`}
                defaultValue={byDay[day]}
                className="input"
                placeholder="None"
                aria-label={`${name} times`}
              />
            </label>
          ))}
        </div>
        <button type="submit" className="btn btn-slop mt-4">
          Save queue
        </button>
      </Form>

      <div className="panel mt-6">
        <h2 className="title-3">Snippets</h2>
        <p className="mt-1 text-muted">
          Hashtag groups, a signature (one can add itself to every post), templates and saved replies, one tap away in
          the composer. Write {"{spintax|variations}"} to vary a post per account, and variables:{" "}
          {Object.keys(VARIABLES)
            .map((name) => `{${name}}`)
            .join(" ")}
          .
        </p>
        {snippets.length > 0 && (
          <ul className="mt-4 grid gap-2">
            {snippets.map((snippet) => (
              <li key={snippet.id} className="flex items-start gap-3 rounded-xl bg-raised p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {snippet.name}{" "}
                    <span className="text-sm font-normal text-muted">
                      · {SNIPPET_KINDS[snippet.kind]}
                      {snippet.autoAdd ? " · adds itself" : ""}
                    </span>
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm whitespace-pre-wrap text-muted">{snippet.text}</p>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="snippet-delete" />
                  <input type="hidden" name="id" value={snippet.id} />
                  <button type="submit" className="btn btn-quiet btn-sm">
                    Delete
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}
        <Form method="post" className="mt-4 grid gap-2 sm:grid-cols-[10rem_1fr]">
          <input type="hidden" name="intent" value="snippet" />
          <select name="kind" className="input" aria-label="Kind">
            {Object.entries(SNIPPET_KINDS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input name="name" className="input" placeholder="Name" maxLength={60} aria-label="Snippet name" />
          <textarea
            name="text"
            className="input min-h-20 sm:col-span-2"
            placeholder="#buildinpublic #indiehackers"
            aria-label="Snippet text"
            required
          />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="autoAdd" /> A signature that adds itself to new posts
          </label>
          <button type="submit" className="btn btn-ink btn-sm justify-self-start">
            Save snippet
          </button>
        </Form>
      </div>

      {brands.length > 0 && (
        <div className="panel mt-6">
          <h2 className="title-3">Brand voices</h2>
          <p className="mt-1 text-muted">How each brand sounds. The writing assistant follows it.</p>
          {brands.map((brand) => (
            <Form key={brand.name} method="post" className="mt-4 grid gap-2">
              <input type="hidden" name="intent" value="voice" />
              <input type="hidden" name="brand" value={brand.name} />
              <label className="grid gap-1 font-bold">
                {brand.name}
                <textarea
                  name="voice"
                  defaultValue={brand.voice}
                  className="input min-h-20 font-normal"
                  maxLength={1500}
                  placeholder="Dry, friendly, no exclamation marks. Talks to developers."
                />
              </label>
              <button type="submit" className="btn btn-ink btn-sm justify-self-start">
                Save voice
              </button>
            </Form>
          ))}
        </div>
      )}

      <div className="panel mt-6">
        <h2 className="title-3">Bulk schedule</h2>
        <p className="mt-1 text-muted">
          A spreadsheet saved as CSV, up to {CSV_ROWS} rows. Columns: <code>text</code>, then any of <code>when</code>{" "}
          (2026-11-24 09:30, your time; empty takes the next queue time), <code>link</code>, <code>tags</code>,{" "}
          <code>first_comment</code>. Every row is checked like a post.
        </p>
        <Form method="post" encType="multipart/form-data" className="mt-4 grid gap-3">
          <input type="hidden" name="intent" value="csv" />
          <input type="file" name="file" accept=".csv,text/csv" className="input" aria-label="CSV file" />
          <AccountPicker accounts={accounts} name="accounts" />
          <button type="submit" className="btn btn-ink btn-sm justify-self-start">
            Schedule rows
          </button>
        </Form>
        {actionData?.error && (
          <p className="mt-3 text-hot" role="alert">
            {actionData.error}
          </p>
        )}
        {actionData?.results && actionData.results.length > 0 && (
          <ul className="mt-3 grid gap-1 text-sm">
            {actionData.results.map((result) => (
              <li key={result.row} className={result.ok ? "text-slop-text" : "text-hot"}>
                Row {result.row}: {result.message}{" "}
                {result.postId && (
                  <Link to={`/studio/posts/${result.postId}`} className="underline">
                    open
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel mt-6">
        <h2 className="title-3">RSS feeds</h2>
        <p className="mt-1 text-muted">
          New items in a blog, changelog or YouTube feed become posts, checked like any other. Items already in the feed
          aren’t posted.
        </p>
        {feeds.length > 0 && (
          <ul className="mt-4 grid gap-2">
            {feeds.map((feed) => (
              <li key={feed.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-raised p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{feed.url}</p>
                  <p className="text-sm text-muted">
                    {feed.active ? "On" : "Off"} · {feed.mode === "queue" ? "next queue time" : "at once"} ·{" "}
                    {feed.accountIds.length} accounts
                    {feed.error && <span className="text-hot"> · {feed.error}</span>}
                  </p>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="feed-toggle" />
                  <input type="hidden" name="id" value={feed.id} />
                  <input type="hidden" name="active" value={String(!feed.active)} />
                  <button type="submit" className="btn btn-quiet btn-sm">
                    {feed.active ? "Turn off" : "Turn on"}
                  </button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="feed-remove" />
                  <input type="hidden" name="id" value={feed.id} />
                  <button type="submit" className="btn btn-quiet btn-sm">
                    Remove
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}
        <Form method="post" className="mt-4 grid gap-3">
          <input type="hidden" name="intent" value="feed" />
          <input
            name="url"
            type="url"
            className="input"
            placeholder="https://yourblog.com/rss.xml"
            aria-label="Feed address"
            required
          />
          <input name="template" className="input" defaultValue="{title} {link}" aria-label="Post template" />
          <select name="mode" className="input" aria-label="When">
            <option value="queue">At the next queue time</option>
            <option value="now">At once</option>
          </select>
          <AccountPicker accounts={accounts} name="accounts" />
          <button type="submit" className="btn btn-ink btn-sm justify-self-start">
            Add feed
          </button>
        </Form>
      </div>

      <div className="panel mt-6">
        <h2 className="title-3">Calendar feed</h2>
        <p className="mt-1 text-muted">
          See scheduled and sent posts in Google Calendar, Apple Calendar or Outlook. Anyone with the address can read
          it.
        </p>
        {settings.calendarUrl ? (
          <div className="mt-3 grid gap-2">
            <code className="block rounded-xl bg-sunk p-3 text-sm break-all">{settings.calendarUrl}</code>
            <div className="flex gap-2">
              <div className="w-40">
                <CopyButton value={settings.calendarUrl} label="Copy address" />
              </div>
              <Form method="post">
                <input type="hidden" name="intent" value="calendar-revoke" />
                <button type="submit" className="btn btn-quiet btn-sm">
                  Turn off
                </button>
              </Form>
            </div>
          </div>
        ) : (
          <Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="calendar-create" />
            <button type="submit" className="btn btn-ink btn-sm">
              Make a calendar address
            </button>
          </Form>
        )}
      </div>

      <Form method="post" className="panel mt-6 grid gap-3">
        <input type="hidden" name="intent" value="webhook" />
        <h2 className="title-3">Webhook</h2>
        <p className="text-muted">
          Slopper posts <code>post.published</code> and <code>post.failed</code> here (for Zapier, Make, n8n or your own
          code), signed: <code>x-slopper-signature: sha256=</code>HMAC of the body with your secret.
        </p>
        <input
          name="url"
          type="url"
          defaultValue={settings.webhook?.url ?? ""}
          className="input"
          placeholder="https://hooks.zapier.com/…"
          aria-label="Webhook address"
        />
        {settings.webhook && (
          <p className="text-sm text-muted" data-no-replay>
            Secret: <code>{settings.webhook.secret}</code>
            {settings.webhook.lastStatus && ` · last answer ${settings.webhook.lastStatus}`}
          </p>
        )}
        <button type="submit" className="btn btn-ink btn-sm justify-self-start">
          Save webhook
        </button>
      </Form>

      <div className="panel mt-6">
        <h2 className="title-3">Share to the studio</h2>
        <p className="mt-1 text-muted">
          Make a bookmark with this as its address. Click it on any page to start a post with that page’s title and
          link.
        </p>
        <code className="mt-3 block rounded-xl bg-sunk p-3 text-sm break-all">{bookmarklet}</code>
        <div className="mt-2 w-48">
          <CopyButton value={bookmarklet} label="Copy bookmarklet" />
        </div>
      </div>
    </section>
  );
}
