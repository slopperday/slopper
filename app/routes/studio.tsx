import { useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, useFetcher, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/studio";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex, convexMessage } from "~/.server/convex";
import { config } from "~/.server/config";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { modeFor } from "~/.server/social/crosspost";
import { bestTimes, nextAt, nextQueueSlot, saveStudioPost, type StudioInput } from "~/.server/social/studio";
import { type CreatorInfo, creatorInfo } from "~/.server/social/tiktok";
import { ASSIST_ACTIONS, type AssistAction } from "~/lib/assist";
import { fitText, measureFor } from "~/lib/compose";
import { wallTime } from "~/lib/csv";
import { slopPath } from "~/lib/display";
import {
  INSTAGRAM_FORMATS,
  NETWORKS,
  type NetworkOptions,
  type PostShape,
  type SocialProvider,
  textLimitFor,
  TIKTOK_PRIVACY,
  type TikTokOptions,
  YOUTUBE_PRIVACY,
  type YouTubeOptions,
} from "~/lib/networks";
import { splitThread } from "~/lib/thread";
import { personalize, VARIABLES } from "~/lib/variables";
import {
  destinationFor,
  type DestinationPost,
  type Issue,
  readiness,
  readinessLabel,
  type Variant,
} from "~/lib/destinations";
import { seo } from "~/lib/seo";
import { Icon, type IconName } from "~/components/Icon";
import {
  AccountAvatar,
  formatCount,
  NetworkBadge,
  PostPreview,
  StatusPill,
  type StudioAccount,
  StudioNav,
  sumMetrics,
} from "~/components/Studio";
import {
  type Attachment,
  Counters,
  MediaTray,
  Segmented,
  SOCIAL_ORDER,
  TikTokFields,
  uploadPicture,
  useMediaUploads,
  VariantFields,
  YouTubeFields,
} from "~/components/StudioComposer";

/** TikTok's creator info, kept briefly: the composer must show it, and it changes rarely. */
const creatorCache = new Map<string, { at: number; info: CreatorInfo | null }>();

async function cachedCreatorInfo(account: Parameters<typeof creatorInfo>[0]): Promise<CreatorInfo | null> {
  const hit = creatorCache.get(account._id);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.info;
  const info = await creatorInfo(account).catch((error: unknown) => {
    console.warn("Reading TikTok creator info failed", error);
    return null;
  });
  creatorCache.set(account._id, { at: Date.now(), info });
  return info;
}

const DAY = 86_400_000;

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const search = new URL(request.url).searchParams;
  const editId = search.get("edit");
  const copyId = search.get("copy");
  const [accounts, organizations, slops, posts, snippets, settings, sent, taken, editing] = await Promise.all([
    convex.query(api.accounts.list, { userId: user._id }),
    convex.query(api.organizations.list, { userId: user._id }),
    convex.query(api.slops.listForServer, { userId: user._id }),
    convex.query(api.social.list, { userId: user._id, limit: 30 }),
    convex.query(api.studio.snippets, { userId: user._id }),
    convex.query(api.studio.settings, { userId: user._id }),
    convex.query(api.social.sent, { userId: user._id, since: Date.now() - 90 * DAY }),
    convex.query(api.social.scheduledTimes, { userId: user._id }),
    editId ? convex.query(api.social.get, { userId: user._id, postId: editId }) : null,
  ]);
  const copy = copyId ? await convex.query(api.social.get, { userId: user._id, postId: copyId }) : null;
  const orgById = new Map(organizations.map((org) => [String(org.id), org.name]));

  // One entry per product, from its newest launch: its name, link, screenshots and the accounts it posts and reposts as.
  const products = new Map<
    string,
    {
      id: string;
      name: string;
      tagline: string;
      url: string;
      screenshots: string[];
      accountIds: string[];
      repostAccountIds: string[];
    }
  >();
  for (const slop of slops) {
    const id = slop.productId ?? slop._id;
    if (products.has(id)) continue;
    products.set(id, {
      id,
      name: slop.name,
      tagline: slop.tagline,
      url: new URL(slopPath(user.username, slop.slug), config.appUrl).href,
      screenshots: slop.screenshots.slice(0, 4),
      accountIds: accounts.filter((account) => modeFor(slop, account) === "post").map((account) => account._id),
      repostAccountIds: accounts
        .filter((account) => modeFor(slop, account) === "amplify" && NETWORKS[account.provider].canRepost)
        .map((account) => account._id),
    });
  }
  const screenshotUrls = await convex.query(api.social.mediaForOwner, {
    ownerId: user._id,
    mediaIds: [...products.values()].flatMap((product) => product.screenshots).slice(0, 12),
  });

  const tiktok: Record<string, CreatorInfo | null> = {};
  for (const account of accounts.filter((item) => item.provider === "tiktok")) {
    tiktok[account._id] = await cachedCreatorInfo(account);
  }

  return {
    // Sealed credentials never leave the server.
    accounts: accounts.map(
      ({ _id, provider, handle, displayName, avatarUrl, brand, organizationId, broken, longPosts }) => ({
        id: _id,
        provider,
        handle,
        displayName,
        avatarUrl,
        brand: brand ?? null,
        organizationId: organizationId ? String(organizationId) : null,
        organizationName: organizationId ? (orgById.get(String(organizationId)) ?? null) : null,
        broken: broken ?? null,
        longPosts: longPosts ?? false,
      }),
    ),
    organizations: organizations.map((org) => ({
      id: String(org.id),
      name: org.name,
      slug: org.slug,
      role: org.role,
    })),
    products: [...products.values()].map((product) => ({
      ...product,
      screenshots: product.screenshots
        .map((id) => screenshotUrls.find((item) => item.id === id))
        .filter((item): item is NonNullable<typeof item> => !!item?.url)
        .map((item) => ({ id: item.id, url: item.url! })),
    })),
    tiktok,
    posts,
    snippets,
    paused: settings.paused,
    best: bestTimes(sent, user.timeZone).map((slot) => ({ ...slot, at: nextAt(slot.day, slot.minute, user.timeZone) })),
    // Each account's own best times, from its own results: estimates, labelled as such.
    bestByAccount: Object.fromEntries(
      accounts.map((account) => [
        String(account._id),
        bestTimes(
          sent.filter((row) => row.accountId === account._id),
          user.timeZone,
        ).map((slot) => ({ ...slot, at: nextAt(slot.day, slot.minute, user.timeZone) })),
      ]),
    ),
    lastAccountIds: (settings.lastAccountIds ?? []).map(String),
    workflows: settings.workflows.map((workflow) => ({ ...workflow, accountIds: workflow.accountIds.map(String) })),
    defaultWorkflowId: settings.defaultWorkflowId,
    nextQueueAt: nextQueueSlot(settings.slots, taken, user.timeZone),
    editing: editing && editing.editable ? editing : null,
    copy,
    prefill: { text: search.get("text") ?? "", link: search.get("link") ?? "" },
    canPost: config.contentCheck !== null,
    canAssist: config.contentCheck !== null,
    timeZone: user.timeZone,
    previewTime: Date.now(),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
  if (formText(form, "intent") === "workflow") {
    try {
      const id = await convex.mutation(api.studio.saveWorkflow, {
        userId: user._id,
        name: formText(form, "name"),
        accountIds: form.getAll("accountIds").map(String),
        when: formText(form, "when") === "queue" ? "queue" : "now",
        productId: formText(form, "productId") || null,
        trackLinks: form.get("trackLinks") === "on",
        makeDefault: form.get("makeDefault") === "on",
      });
      return { workflowSaved: id };
    } catch (error) {
      return { workflowError: convexMessage(error) ?? "That workflow didn't save." };
    }
  }
  if (formText(form, "intent") === "discard") {
    await convex.mutation(api.social.discard, { userId: user._id, postId: formText(form, "postId") });
    return redirectWithFlash("/studio", { tone: "info", message: "Draft deleted." });
  }
  let input: StudioInput;
  try {
    input = parsePayload(formText(form, "payload"), formText(form, "submit"), user.timeZone);
  } catch {
    return redirectWithFlash("/studio", { tone: "error", message: "That post didn't arrive whole. Try again." });
  }
  const result = await saveStudioPost(user, input);
  if (!result.ok) return { error: result.error };
  return redirectWithFlash(`/studio/posts/${result.postId}`, {
    tone: "success",
    message: result.draft
      ? "Draft saved. Nothing goes out until you post it."
      : result.scheduled
        ? `Scheduled for ${new Date(result.scheduledAt!).toLocaleString("en-GB", { timeZone: user.timeZone, dateStyle: "medium", timeStyle: "short" })}. It goes out on its own.`
        : "Sent. Each account's copy is below.",
  });
}

/** The composer's JSON, read defensively: every field typed, nothing else kept. */
function parsePayload(raw: string, submit: string, timeZone: string): StudioInput {
  const value = JSON.parse(raw) as Record<string, unknown>;
  const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item) => typeof item === "string") : []);
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : undefined);
  const options = (value.options ?? {}) as NetworkOptions;
  const repeat = value.repeat as { everyDays?: unknown; remaining?: unknown } | null;
  const plug = value.plug as { likes?: unknown; text?: unknown } | null;
  return {
    postId: str(value.postId) || null,
    text: str(value.text).slice(0, 10_000),
    link: str(value.link).slice(0, 2048),
    productId: str(value.productId) || null,
    accountIds: strings(value.accountIds).slice(0, 50),
    repostAccountIds: strings(value.repostAccountIds).slice(0, 50),
    media: (Array.isArray(value.media) ? value.media : []).slice(0, 12).map((item: Record<string, unknown>) => ({
      id: str(item.id),
      duration: num(item.duration),
      width: num(item.width),
      height: num(item.height),
      alt: str(item.alt).slice(0, 1000) || undefined,
      coverAt: num(item.coverAt),
    })),
    frames: strings(value.frames).slice(0, 3),
    overrides: Object.fromEntries(
      Object.entries((value.overrides ?? {}) as Record<string, unknown>)
        .filter(([, words]) => typeof words === "string")
        .map(([provider, words]) => [provider, String(words).slice(0, 25_000)]),
    ),
    options: {
      ...(options.youtube
        ? {
            youtube: {
              title: str(options.youtube.title).slice(0, 200),
              privacy: (YOUTUBE_PRIVACY as readonly string[]).includes(options.youtube.privacy)
                ? options.youtube.privacy
                : "private",
              madeForKids: options.youtube.madeForKids === true,
            },
          }
        : {}),
      ...(options.tiktok
        ? {
            tiktok: {
              privacy: (TIKTOK_PRIVACY as readonly (string | null)[]).includes(options.tiktok.privacy)
                ? options.tiktok.privacy
                : null,
              allowComments: options.tiktok.allowComments === true,
              allowDuet: options.tiktok.allowDuet === true,
              allowStitch: options.tiktok.allowStitch === true,
              brandedContent: options.tiktok.brandedContent === true,
              yourBrand: options.tiktok.yourBrand === true,
            },
          }
        : {}),
      ...(options.instagram
        ? {
            instagram: {
              format: options.instagram.format === "story" ? ("story" as const) : ("feed" as const),
              collaborators: strings(options.instagram.collaborators).slice(0, 5),
            },
          }
        : {}),
      ...(options.linkedin ? { linkedin: { documentTitle: str(options.linkedin.documentTitle).slice(0, 200) } } : {}),
    },
    // Times arrive as the wall-clock time typed, read in the person's own time zone (not the browser's).
    scheduledAt: submit === "schedule" ? wallTime(str(value.scheduledAtLocal), timeZone) : null,
    times: Object.fromEntries(
      Object.entries((value.timesLocal ?? {}) as Record<string, unknown>)
        .map(([id, local]) => [id, wallTime(str(local), timeZone)] as const)
        .filter((entry): entry is readonly [string, number] => entry[1] !== null),
    ),
    variants: Object.fromEntries(
      Object.entries((value.variants ?? {}) as Record<string, Record<string, unknown> | null>)
        .filter(([, variant]) => variant && typeof variant === "object")
        .slice(0, 60)
        .map(([key, variant]) => [
          key,
          {
            ...(Array.isArray(variant!.media) ? { media: strings(variant!.media).slice(0, 20) } : {}),
            ...(variant!.link === null || typeof variant!.link === "string"
              ? { link: variant!.link === null ? null : str(variant!.link).slice(0, 2048) }
              : {}),
            ...(typeof variant!.firstComment === "string"
              ? { firstComment: str(variant!.firstComment).slice(0, 5000) }
              : {}),
          },
        ]),
    ),
    queue: submit === "queue",
    draft: submit === "draft",
    thread: strings(value.thread).slice(0, 30),
    firstComment: str(value.firstComment).slice(0, 5000),
    note: str(value.note).slice(0, 2000),
    tags: strings(value.tags).slice(0, 10),
    repeat:
      repeat && num(repeat.everyDays) && num(repeat.remaining)
        ? { everyDays: num(repeat.everyDays)!, remaining: num(repeat.remaining)! }
        : null,
    staggerMinutes: num(value.staggerMinutes) ?? 0,
    plug:
      plug && num(plug.likes) && str(plug.text).trim()
        ? { likes: num(plug.likes)!, text: str(plug.text).slice(0, 1000) }
        : null,
    trackLinks: value.trackLinks === true,
    coverMediaId: str(value.coverMediaId) || null,
    source: "web",
  };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Studio", noindex: true });

// ---------------------------------------------------------------------------
// The composer

type ComposerAccount = StudioAccount & { broken: string | null; longPosts: boolean };

const DEFAULT_YOUTUBE: YouTubeOptions = { title: "", privacy: "public", madeForKids: false };
const DEFAULT_TIKTOK: TikTokOptions = {
  privacy: null,
  allowComments: true,
  allowDuet: true,
  allowStitch: true,
  brandedContent: false,
  yourBrand: false,
};
const REPEATS = [
  { label: "Once", days: 0 },
  { label: "Every day", days: 1 },
  { label: "Every 3 days", days: 3 },
  { label: "Every week", days: 7 },
  { label: "Every 2 weeks", days: 14 },
  { label: "Every month", days: 30 },
] as const;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A datetime-local value for `at` in `timeZone`. */
function localInput(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** What autosave keeps of an unfinished post in this browser. */
interface Saved {
  text: string;
  link: string;
  overrides: Record<string, string | undefined>;
  variants: Record<string, Variant | undefined>;
  thread: string[];
  firstComment: string;
  selected: string[];
  productId: string;
  media: { key: string; kind: Attachment["kind"]; id: string; url: string; duration?: number; alt?: string }[];
  tags: string;
  note: string;
}

export default function Studio({ loaderData, actionData }: Route.ComponentProps) {
  const {
    accounts,
    organizations,
    products,
    posts,
    tiktok,
    canPost,
    canAssist,
    snippets,
    best,
    editing,
    prefill,
    paused,
    timeZone,
    previewTime,
    lastAccountIds,
    bestByAccount,
    workflows,
    defaultWorkflowId,
    nextQueueAt,
  } = loaderData;
  const navigation = useNavigation();
  const sending = navigation.state !== "idle" && navigation.formMethod === "POST";
  const [params] = useSearchParams();
  const saver = useFetcher<typeof action>();

  const signature = snippets.find((snippet) => snippet.autoAdd);
  // Editing keeps the post; "Use again" starts a new one from a copy of it.
  const base = editing ?? loaderData.copy;
  const live = (ids: readonly string[]) =>
    ids.filter((id) => accounts.some((account) => account.id === id && !account.broken));
  // A new post starts the way this person usually posts: their default workflow, else the last post's accounts.
  const defaultWorkflow = workflows.find((workflow) => workflow.id === defaultWorkflowId) ?? null;
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(
      base
        ? base.deliveries.filter((row) => !row.repost).map((row) => row.accountId)
        : live(defaultWorkflow?.accountIds ?? lastAccountIds),
    ),
  );
  const [reposters, setReposters] = useState<ReadonlySet<string>>(
    new Set(base?.deliveries.filter((row) => row.repost).map((row) => row.accountId) ?? []),
  );
  const [picking, setPicking] = useState(selected.size === 0);
  const [previewAccountId, setPreviewAccountId] = useState<string | null>(null);
  const [productId, setProductId] = useState(base?.product?.id ?? (base ? "" : (defaultWorkflow?.productId ?? "")));
  const [text, setText] = useState(
    base?.text ?? (prefill.text ? prefill.text : signature ? `\n\n${signature.text}` : ""),
  );
  const [link, setLink] = useState(base?.link ?? prefill.link);
  const [overrides, setOverrides] = useState<Record<string, string | undefined>>(base?.overrides ?? {});
  // The words tab: everywhere, or one network (and on it, every account or one of them).
  const [tab, setTab] = useState<"all" | SocialProvider>("all");
  const [tabAccount, setTabAccount] = useState<string | null>(null);
  const [thread, setThread] = useState<string[]>(base?.thread ?? []);
  const [firstComment, setFirstComment] = useState(base?.firstComment ?? "");
  const [commenting, setCommenting] = useState(Boolean(base?.firstComment));
  const [media, setMedia] = useState<Attachment[]>(
    base?.media
      .filter((item) => item.url)
      .map((item) => ({
        key: item.id,
        kind: item.kind,
        id: item.id,
        url: item.url!,
        progress: 1,
        error: null,
        duration: item.duration ?? undefined,
        width: item.width ?? undefined,
        height: item.height ?? undefined,
        alt: item.alt,
        coverAt: item.coverAt ?? undefined,
        fileName: item.kind === "document" ? "document.pdf" : undefined,
      })) ?? [],
  );
  const [cover, setCover] = useState<{ id: string | null; busy: boolean }>({
    id: base?.cover?.id ?? null,
    busy: false,
  });
  const [youtube, setYouTube] = useState(base?.options.youtube ?? DEFAULT_YOUTUBE);
  const [tiktokOptions, setTikTok] = useState(base?.options.tiktok ?? DEFAULT_TIKTOK);
  const [instagramFormat, setInstagramFormat] = useState<(typeof INSTAGRAM_FORMATS)[number]>(
    base?.options.instagram?.format ?? "feed",
  );
  const [collaborators, setCollaborators] = useState((base?.options.instagram?.collaborators ?? []).join(", "));
  const [documentTitle, setDocumentTitle] = useState(base?.options.linkedin?.documentTitle ?? "");
  const [when, setWhen] = useState<"now" | "queue" | "later">(
    editing?.scheduledAt ? "later" : base ? "now" : (defaultWorkflow?.when ?? "now"),
  );
  const [scheduledAt, setScheduledAt] = useState(editing?.scheduledAt ? localInput(editing.scheduledAt, timeZone) : "");
  const [repeatDays, setRepeatDays] = useState(base?.repeat?.everyDays ?? 0);
  const [repeatTimes, setRepeatTimes] = useState(base?.repeat?.remaining ?? 4);
  const [stagger, setStagger] = useState(base?.staggerMinutes ?? 0);
  const [plugOn, setPlugOn] = useState(!!base?.plug);
  const [plugLikes, setPlugLikes] = useState(base?.plug?.likes ?? 50);
  const [plugText, setPlugText] = useState(base?.plug?.text ?? "");
  const [trackLinks, setTrackLinks] = useState(
    base?.trackLinks ?? (base ? false : (defaultWorkflow?.trackLinks ?? false)),
  );
  const [tags, setTags] = useState((base?.tags ?? []).join(", "));
  const [note, setNote] = useState(base?.note ?? "");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [assisting, setAssisting] = useState<AssistAction | null>(null);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [extras, setExtras] = useState(Boolean(base?.note || base?.tags.length || base?.plug || base?.staggerMinutes));
  const [variants, setVariants] = useState<Record<string, Variant | undefined>>(base?.variants ?? {});
  const [timeMode, setTimeMode] = useState<"same" | "each">(
    editing && Object.keys(editing.times ?? {}).length ? "each" : "same",
  );
  const [times, setTimes] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(editing?.times ?? {}).map(([id, at]) => [id, localInput(at, timeZone)])),
  );
  const [restorable, setRestorable] = useState<{ savedAt: number; state: Saved } | null>(null);
  const [naming, setNaming] = useState<{ name: string; makeDefault: boolean } | null>(null);
  const [dropping, setDropping] = useState(false);
  const autosaveKey = editing ? `slopper-studio:${editing.id}` : loaderData.copy ? null : "slopper-studio:new";
  const pictureInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const submitButton = useRef<HTMLButtonElement>(null);
  const uploads = useMediaUploads(media, setMedia, setUploadError);

  // Autosave: an unfinished post survives a refresh or a closed tab, in this browser.
  useEffect(() => {
    if (!autosaveKey) return;
    try {
      const raw = window.localStorage.getItem(autosaveKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as { savedAt: number; state: Saved };
      const fresh = Date.now() - saved.savedAt < 7 * 86_400_000;
      if (fresh && (saved.state.text.trim() || saved.state.media.length) && saved.state.text !== text)
        setRestorable(saved);
      else if (!fresh) window.localStorage.removeItem(autosaveKey);
    } catch {
      // A broken or full store just means no autosave.
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival.
  }, []);

  useEffect(() => {
    if (!autosaveKey || restorable) return;
    const state: Saved = {
      text,
      link,
      overrides,
      variants,
      thread,
      firstComment,
      selected: [...selected],
      productId,
      media: media
        .filter((item) => item.id)
        .map((item) => ({
          key: item.key,
          kind: item.kind,
          id: item.id!,
          url: item.remoteUrl ?? item.url,
          duration: item.duration,
          alt: item.alt,
        })),
      tags,
      note,
    };
    const timer = window.setTimeout(() => {
      try {
        if (!state.text.trim() && state.media.length === 0) window.localStorage.removeItem(autosaveKey);
        else window.localStorage.setItem(autosaveKey, JSON.stringify({ savedAt: Date.now(), state }));
      } catch {
        // Storage full or blocked: nothing to do.
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    autosaveKey,
    restorable,
    text,
    link,
    overrides,
    variants,
    thread,
    firstComment,
    selected,
    productId,
    media,
    tags,
    note,
  ]);

  function restore(saved: Saved) {
    setText(saved.text);
    setLink(saved.link);
    setOverrides(saved.overrides);
    setVariants(saved.variants);
    setThread(saved.thread);
    setFirstComment(saved.firstComment);
    setCommenting(Boolean(saved.firstComment));
    setSelected(new Set(saved.selected));
    setProductId(saved.productId);
    setMedia(saved.media.map((item) => ({ ...item, progress: 1, error: null })));
    setTags(saved.tags);
    setNote(saved.note);
    setRestorable(null);
  }

  function forgetAutosave() {
    if (autosaveKey) window.localStorage.removeItem(autosaveKey);
    setRestorable(null);
  }

  // A product picked from a link (?product=) starts with its accounts.
  useEffect(() => {
    const id = params.get("product");
    if (id && !editing) pickProduct(id);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival.
  }, []);

  // A saved workflow closes its form.
  useEffect(() => {
    if (saver.state === "idle" && saver.data && "workflowSaved" in saver.data) setNaming(null);
  }, [saver.state, saver.data]);

  const picked = accounts.filter((account) => selected.has(account.id));
  const providers = new Set(picked.map((account) => account.provider));
  const activeTab: "all" | SocialProvider = tab !== "all" && providers.has(tab) ? tab : "all";
  const tabAccounts = activeTab === "all" ? [] : picked.filter((account) => account.provider === activeTab);
  const editingAccount =
    activeTab === "all" || tabAccounts.length < 2
      ? null
      : (tabAccounts.find((account) => account.id === tabAccount) ?? null);
  const editingNetwork: SocialProvider | null = activeTab === "all" ? null : activeTab;
  const editingOverrideTarget = editingNetwork ? (editingAccount?.id ?? editingNetwork) : null;
  const targetLabel = editingAccount
    ? editingAccount.displayName || editingAccount.handle
    : editingNetwork
      ? NETWORKS[editingNetwork].label
      : "";

  const video = media.find((item) => item.kind === "video");
  const shape: PostShape = {
    images: media.filter((item) => item.kind === "image").length,
    video: video ? (video.duration ?? 0) : null,
    documents: media.filter((item) => item.kind === "document").length,
  };
  const uploading = media.some((item) => item.id === null && !item.error) || cover.busy;
  const limits: Partial<Record<SocialProvider, number>> = {};
  for (const account of picked) {
    limits[account.provider] = Math.min(limits[account.provider] ?? Infinity, textLimitFor(account.provider, account));
  }
  const threadNetworks = SOCIAL_ORDER.filter((provider) => providers.has(provider) && NETWORKS[provider].threads);
  const threadLimit = Math.min(
    ...threadNetworks.map((provider) => limits[provider] ?? NETWORKS[provider].textLimit),
    5000,
  );
  const commentNetworks = SOCIAL_ORDER.filter((provider) => providers.has(provider) && NETWORKS[provider].firstComment);
  const options: NetworkOptions = {
    ...(providers.has("youtube") ? { youtube } : {}),
    ...(providers.has("tiktok") ? { tiktok: tiktokOptions } : {}),
    ...(providers.has("instagram")
      ? {
          instagram: {
            format: instagramFormat,
            collaborators: collaborators
              .split(/[\s,]+/)
              .map((name) => name.replace(/^@/, ""))
              .filter(Boolean),
          },
        }
      : {}),
    ...(providers.has("linkedin") && shape.documents ? { linkedin: { documentTitle } } : {}),
  };
  // Every picked account's checklist: what it will get, and what's in its way.
  const destinationPost: DestinationPost = {
    text,
    link: link.trim() || null,
    media: media.map((item) => ({ id: item.id ?? item.key, kind: item.kind, duration: item.duration ?? null })),
    overrides,
    variants,
    options,
    thread,
    firstComment,
  };
  const destinations = picked.map((account) => ({ ...account, broken: account.broken }));
  // Before a word is written, an empty post isn't a problem to flag on every account.
  const empty = !text.trim() && media.length === 0;
  const checklist = picked.map((account) => {
    const issues = readiness(destinationPost, account, destinations).filter(
      (issue) => !(empty && issue.field === "text"),
    );
    return { account, issues, label: readinessLabel(issues) };
  });
  const blocked = checklist.filter((entry) => entry.label.tone === "block");
  const blockedNetworks = new Set(blocked.map((entry) => entry.account.provider));
  const missingTimes = when === "later" && timeMode === "each" ? picked.filter((account) => !times[account.id]) : [];
  const problems = [
    ...(!text.trim() && media.length === 0 ? ["Write something or add a picture or video."] : []),
    ...(when === "later" && timeMode === "same" && !scheduledAt ? ["Pick when it goes out."] : []),
    ...(missingTimes.length ? [`Pick a time for ${missingTimes.map((account) => account.handle).join(", ")}.`] : []),
  ];
  const ready = canPost && picked.length > 0 && blocked.length === 0 && problems.length === 0 && !uploading;
  // An idea can be saved before it has anywhere to go.
  const canDraft = !uploading && (text.trim() || media.length > 0);

  const brands = useMemo(() => {
    const groups = new Map<string, ComposerAccount[]>();
    for (const account of accounts) {
      const name =
        account.brand ?? (account.organizationName ? `${account.organizationName} (Shared)` : "No brand yet");
      groups.set(name, [...(groups.get(name) ?? []), account]);
    }
    return [...groups.entries()].sort(([a], [b]) =>
      a === "No brand yet" ? 1 : b === "No brand yet" ? -1 : a.localeCompare(b),
    );
  }, [accounts]);
  // Accounts that could repost: on a network that reposts, where another picked account posts.
  const repostCandidates = accounts.filter(
    (account) => !selected.has(account.id) && NETWORKS[account.provider].canRepost && providers.has(account.provider),
  );
  const brand = picked.find((account) => account.brand)?.brand ?? "";
  const product = products.find((item) => item.id === productId) ?? null;

  // One-tap sets: saved workflows, the last post's accounts, each product's accounts, and everything.
  const same = (ids: readonly string[]) => {
    const usable = live(ids);
    return usable.length > 0 && usable.length === selected.size && usable.every((id) => selected.has(id));
  };
  const sets: QuickSet[] = [
    ...workflows.map((workflow) => ({
      key: `workflow-${workflow.id}`,
      label: workflow.name,
      ids: workflow.accountIds,
      starred: workflow.id === defaultWorkflowId,
      apply: () => applyWorkflow(workflow),
    })),
    ...(lastAccountIds.length > 0 && !workflows.some((workflow) => sameIds(workflow.accountIds, lastAccountIds))
      ? [{ key: "last", label: "Last used", ids: lastAccountIds, starred: false, apply: () => pickSet(lastAccountIds) }]
      : []),
    ...products
      .filter((item) => item.accountIds.length > 0)
      .map((item) => ({
        key: `product-${item.id}`,
        label: `${item.name}’s accounts`,
        ids: item.accountIds,
        starred: false,
        apply: () => pickProduct(item.id),
      })),
    ...(accounts.length > 1
      ? [
          {
            key: "everything",
            label: "Everywhere",
            ids: accounts.map((account) => account.id),
            starred: false,
            apply: () => pickSet(accounts.map((account) => account.id)),
          },
        ]
      : []),
  ].filter((set) => live(set.ids).length > 0);
  const savedAlready = workflows.some((workflow) => same(workflow.accountIds));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setReposters((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function toggleBrand(list: readonly ComposerAccount[]) {
    setSelected((current) => {
      const all = list.every((account) => current.has(account.id));
      const next = new Set(current);
      for (const account of list) {
        if (all) next.delete(account.id);
        else next.add(account.id);
      }
      return next;
    });
  }

  function pickProduct(id: string) {
    setProductId(id);
    const item = products.find((entry) => entry.id === id);
    if (item) {
      setSelected(new Set(live(item.accountIds)));
      setReposters(new Set(item.repostAccountIds));
    }
  }

  /** One tap: exactly these accounts, nothing else. */
  function pickSet(ids: readonly string[]) {
    setSelected(new Set(live(ids)));
    setReposters(new Set());
  }

  function applyWorkflow(workflow: (typeof workflows)[number]) {
    pickSet(workflow.accountIds);
    setProductId(workflow.productId ?? "");
    setTrackLinks(workflow.trackLinks);
    if (!editing) setWhen(workflow.when);
  }

  function saveWorkflow() {
    if (!naming) return;
    const form = new FormData();
    form.set("intent", "workflow");
    form.set("name", naming.name);
    for (const id of selected) form.append("accountIds", id);
    form.set("when", when === "queue" ? "queue" : "now");
    form.set("productId", productId);
    if (trackLinks) form.set("trackLinks", "on");
    if (naming.makeDefault) form.set("makeDefault", "on");
    void saver.submit(form, { method: "post" });
  }

  /** Takes the person to what fixes an issue. */
  function fix(account: ComposerAccount, issue: Issue) {
    if (issue.field === "account") {
      window.location.assign("/settings/autopost");
      return;
    }
    let target = "studio-text";
    if (
      issue.field === "copy" ||
      issue.field === "youtube" ||
      issue.field === "tiktok" ||
      issue.field === "instagram"
    ) {
      setTab(account.provider);
      setTabAccount(
        issue.field === "copy" && picked.filter((item) => item.provider === account.provider).length > 1
          ? account.id
          : null,
      );
      target = issue.field === "copy" ? "studio-words" : "studio-network-options";
    } else {
      setTab("all");
      if (issue.field === "media") target = "studio-media-tools";
    }
    requestAnimationFrame(() => {
      const element = document.getElementById(target);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      (element?.matches("textarea, input, select, button")
        ? element
        : element?.querySelector<HTMLElement>("textarea, input, select, button")
      )?.focus({ preventScroll: true });
    });
  }

  function setVariant(key: string, change: Partial<Variant> | null) {
    setVariants((current) => {
      if (change === null) {
        const { [key]: _gone, ...rest } = current;
        return rest;
      }
      return { ...current, [key]: { ...current[key], ...change } };
    });
  }

  /** Starts the post from the product: its tagline, its Slopper page and its screenshots. */
  function startFromProduct() {
    if (!product) return;
    setText(`${product.name}: ${product.tagline}${signature ? `\n\n${signature.text}` : ""}`);
    setLink(product.url);
    if (media.length === 0 && product.screenshots.length > 0) {
      setMedia(
        product.screenshots.map((shot) => ({
          key: shot.id,
          kind: "image",
          id: shot.id,
          url: shot.url,
          progress: 1,
          error: null,
          alt: "",
        })),
      );
    }
  }

  function insert(words: string) {
    setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${words}` : words));
  }

  async function runAssist(name: AssistAction) {
    setAssisting(name);
    setAssistError(null);
    try {
      const response = await fetch("/api/studio/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: name,
          text: editingOverrideTarget ? overrides[editingOverrideTarget] || text : text,
          network: name === "adapt" ? editingNetwork : null,
          brand: editingAccount?.brand ?? brand,
        }),
      });
      const body = (await response.json()) as { text?: string; posts?: string[]; hashtags?: string[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "The assistant didn't answer.");
      if (body.posts?.length) {
        setText(body.posts[0]);
        setThread(body.posts.slice(1));
      } else if (body.hashtags) setHashtags(body.hashtags);
      else if (body.text && name === "adapt" && editingOverrideTarget)
        setOverrides({ ...overrides, [editingOverrideTarget]: body.text });
      else if (body.text) setText(body.text);
    } catch (error) {
      setAssistError(error instanceof Error ? error.message : "The assistant didn't answer.");
    } finally {
      setAssisting(null);
    }
  }

  function autoSplit() {
    const measure = measureFor(threadNetworks[0] ?? "x");
    const parts = splitThread([text, ...thread].join("\n---\n"), threadLimit, measure);
    setText(parts[0] ?? "");
    setThread(parts.slice(1));
  }

  async function makeThumbnail(frame: Blob) {
    setCover({ id: cover.id, busy: true });
    try {
      const uploaded = await uploadPicture(frame, "thumbnail.jpg");
      setCover({ id: uploaded.id, busy: false });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Couldn't save the thumbnail.");
      setCover({ id: cover.id, busy: false });
    }
  }

  const payload = JSON.stringify({
    postId: editing?.id ?? null,
    text,
    link,
    productId: productId || null,
    accountIds: [...selected],
    repostAccountIds: [...reposters].filter((id) => repostCandidates.some((account) => account.id === id)),
    media: media
      .filter((item) => item.id)
      .map(({ id, duration, width, height, alt, coverAt }) => ({ id, duration, width, height, alt, coverAt })),
    frames: video?.frames ?? [],
    overrides,
    options,
    // Wall-clock times as typed: the server reads them in the profile's time zone.
    scheduledAtLocal:
      when !== "later"
        ? ""
        : timeMode === "each"
          ? (picked
              .map((account) => times[account.id])
              .filter(Boolean)
              .sort()[0] ?? "")
          : scheduledAt,
    timesLocal:
      when === "later" && timeMode === "each"
        ? Object.fromEntries(
            picked.filter((account) => times[account.id]).map((account) => [account.id, times[account.id]]),
          )
        : {},
    variants: Object.fromEntries(
      Object.entries(variants).filter(
        ([key, variant]) => variant && (providers.has(key as SocialProvider) || selected.has(key)),
      ),
    ),
    thread: threadNetworks.length ? thread : [],
    firstComment: commentNetworks.length ? firstComment : "",
    note,
    tags: tags
      .split(/[\s,]+/)
      .map((tag) => tag.replace(/^#/, ""))
      .filter(Boolean),
    repeat: repeatDays && when !== "now" ? { everyDays: repeatDays, remaining: repeatTimes } : null,
    staggerMinutes: stagger,
    plug: plugOn && threadNetworks.length ? { likes: plugLikes, text: plugText } : null,
    trackLinks: trackLinks && !!link.trim(),
    coverMediaId: providers.has("youtube") ? cover.id : null,
  });

  // One preview per selected account, ordered by network so multiple accounts on the same network each show their own preview.
  const previews = SOCIAL_ORDER.flatMap((provider) =>
    picked
      .filter((item) => item.provider === provider)
      .map((account) => {
        const destination = destinationFor(destinationPost, account);
        const source = destination.text;
        const postLink = destination.link?.trim() || null;
        const ownMedia = destination.media
          .map((entry) => media.find((item) => (item.id ?? item.key) === entry.id))
          .filter((item): item is Attachment => !!item && !!item.id && item.kind !== "document")
          .map(({ kind, url }) => ({ kind: kind as "image" | "video", url }));
        const at = when === "later" && scheduledAt ? (wallTime(scheduledAt, timeZone) ?? previewTime) : previewTime;
        const words = personalize(source, account.id, {
          at,
          timeZone,
          product: product?.name ?? null,
          link: postLink,
          network: NETWORKS[provider].label,
        });
        const limit = textLimitFor(provider, account);
        const measure = measureFor(provider);
        const suffix =
          postLink && provider !== "instagram" && provider !== "tiktok" && !words.includes(postLink)
            ? `\n\n${postLink}`
            : "";
        const fitted = fitText(words.trim(), limit - measure(suffix), measure) + suffix;
        const followUp = (part: string) =>
          fitText(
            personalize(part, account.id, {
              at,
              timeZone,
              product: product?.name ?? null,
              link: null,
              network: NETWORKS[provider].label,
            }).trim(),
            limit,
            measure,
          );
        return {
          account,
          media: ownMedia,
          fitted,
          over: measure(words.trim()) + measure(suffix) > limit,
          replies: NETWORKS[provider].threads ? thread.filter((part) => part.trim()).map(followUp) : [],
          firstComment:
            NETWORKS[provider].firstComment && destination.firstComment.trim()
              ? followUp(destination.firstComment)
              : "",
        };
      }),
  );
  const activePreview =
    previews.find(({ account }) => account.id === previewAccountId) ??
    previews.find(({ account }) => account.provider === editingNetwork) ??
    previews[0];
  const filter = params.get("show") ?? "all";
  const listed = posts.filter((post) => {
    const scheduled = post.scheduledAt !== null && !post.released && !post.cancelled && !post.draft;
    if (filter === "drafts") return post.draft;
    if (filter === "scheduled") return scheduled;
    if (filter === "failed") return post.deliveries.some((row) => row.status === "error");
    return true;
  });
  const broken = accounts.filter((account) => account.broken);
  const clock = (at: number) =>
    new Date(at).toLocaleString("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  const count = `${picked.length} account${picked.length === 1 ? "" : "s"}`;
  const verb = when === "later" ? "Schedule for" : when === "queue" ? "Queue for" : "Post to";

  return (
    <section className="mx-auto max-w-6xl px-4 pt-10 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title-1">Studio</h1>
          <p className="lede mt-3 max-w-2xl">
            Write it once and send it everywhere you post: launches, updates or whatever’s on your mind.
          </p>
        </div>
      </div>
      <div className="mt-8">
        <StudioNav />
      </div>

      {paused && (
        <p className="mt-6 rounded-2xl bg-hot/10 p-4" role="status">
          <strong>Posting is paused.</strong> Nothing scheduled goes out until you{" "}
          <Link to="/studio/settings" className="underline">
            resume
          </Link>
          .
        </p>
      )}
      {broken.length > 0 && (
        <ul className="mt-6 grid gap-2" role="status">
          {broken.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-hot/10 p-3">
              <AccountAvatar account={account} size={28} />
              <span className="flex-1">
                <strong>
                  {account.displayName} on {NETWORKS[account.provider].label}
                </strong>{" "}
                needs reconnecting: {account.broken}
              </span>
              <Link to="/settings/autopost" className="btn btn-ink btn-sm">
                Reconnect
              </Link>
            </li>
          ))}
        </ul>
      )}

      {accounts.length === 0 && <GetStarted />}

      <Form
        method="post"
        onSubmit={() => {
          // A post handed to the server is saved there; an error keeps it on screen, and autosave picks it up again.
          if (autosaveKey) window.localStorage.removeItem(autosaveKey);
        }}
        onKeyDown={(event) => {
          // ⌘/Ctrl + Enter sends (or schedules) from anywhere in the composer.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && ready && !sending) {
            event.preventDefault();
            submitButton.current?.click();
          }
        }}
        className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]"
      >
        <input type="hidden" name="payload" value={payload} />
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          {restorable && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-slop-tint p-3 text-sm" role="status">
              <span className="flex-1">
                You have an unsaved post from{" "}
                {new Date(restorable.savedAt).toLocaleString("en-GB", {
                  timeZone,
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                .
              </span>
              <button type="button" className="btn btn-ink btn-sm" onClick={() => restore(restorable.state)}>
                Restore it
              </button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={forgetAutosave}>
                Discard
              </button>
            </div>
          )}
          {editing && (
            <p className="rounded-2xl bg-sunk p-3 text-sm">
              Editing {editing.draft ? "a draft" : "a scheduled post"}.{" "}
              <Link to="/studio" className="underline">
                Start a new one instead
              </Link>
            </p>
          )}

          {/* The writing card: where it goes, what it's about, the words, the media, the tools. */}
          <div
            className={`relative rounded-3xl bg-raised ring-1 transition-shadow ${dropping ? "ring-4 ring-slop" : "ring-line"}`}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              event.preventDefault();
              setDropping(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.files.length) return;
              event.preventDefault();
              setDropping(false);
              uploads.addFiles([...event.dataTransfer.files]);
            }}
          >
            {dropping && (
              <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-3xl bg-slop-tint/90 font-display text-2xl font-extrabold">
                Drop it in
              </div>
            )}

            {/* 1. Where it goes */}
            <fieldset className="min-w-0 scroll-mt-24 border-b border-line p-4 sm:p-5" id="section-accounts">
              <legend className="sr-only">Post as</legend>
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-sm font-bold text-muted">To</span>
                {picked.length === 0 && (
                  <span className="text-sm text-muted">
                    {accounts.length === 0
                      ? "Connect an account to post. You can still save ideas."
                      : "Nobody yet: pick accounts below."}
                  </span>
                )}
                <ul className="contents" aria-label="Posting as">
                  {picked.map((account) => {
                    const status = checklist.find((entry) => entry.account.id === account.id)?.label;
                    return (
                      <li
                        key={account.id}
                        className={`flex min-h-10 items-center gap-2 rounded-full py-1 pr-1 pl-1 text-sm font-bold ${
                          status?.tone === "block" ? "bg-hot/12 text-hot" : "bg-sunk"
                        }`}
                        title={
                          status && status.tone !== "ready"
                            ? status.text
                            : `${NETWORKS[account.provider].label} · ${account.handle}`
                        }
                      >
                        <AccountAvatar account={account} size={28} />
                        <span className="max-w-40 truncate">{account.displayName || account.handle}</span>
                        <button
                          type="button"
                          className="grid size-7 place-items-center rounded-full text-muted hover:bg-ground hover:text-ink"
                          aria-label={`Leave out ${account.displayName || account.handle} on ${NETWORKS[account.provider].label}`}
                          onClick={() => toggle(account.id)}
                        >
                          <Icon name="close" className="size-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {accounts.length > 0 ? (
                  <button
                    type="button"
                    className="flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-ink hover:bg-sunk"
                    aria-expanded={picking}
                    onClick={() => setPicking(!picking)}
                  >
                    <Icon name={picking ? "chevron" : "plus"} className="size-4" />
                    {picking ? "Done" : picked.length ? "Add or remove" : "Choose accounts"}
                  </button>
                ) : (
                  <Link to="/settings/autopost" className="btn btn-slop btn-sm">
                    <Icon name="plus" className="size-4" /> Connect an account
                  </Link>
                )}
              </div>

              {sets.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Workflows">
                  {sets.map((set) => {
                    const on = same(set.ids);
                    return (
                      <button
                        key={set.key}
                        type="button"
                        aria-pressed={on}
                        onClick={set.apply}
                        className={`flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-bold transition ${
                          on ? "bg-ink text-ground" : "bg-sunk text-ink hover:bg-line"
                        }`}
                      >
                        {set.starred && <Icon name="star" filled className="size-3.5 text-gold" />}
                        {set.label}
                        <span className={on ? "text-ground/70" : "text-muted"}>{live(set.ids).length}</span>
                      </button>
                    );
                  })}
                  {picked.length > 0 && !savedAlready && !naming && (
                    <button
                      type="button"
                      className="min-h-8 rounded-full px-2 text-[0.8125rem] font-bold text-muted underline decoration-dotted underline-offset-4 hover:text-ink"
                      onClick={() => setNaming({ name: "", makeDefault: workflows.length === 0 })}
                    >
                      Save as a workflow
                    </button>
                  )}
                </div>
              )}
              {naming && (
                <div className="mt-3 grid gap-3 rounded-2xl bg-sunk p-3 sm:grid-cols-[1fr_auto] sm:items-end">
                  <label className="grid gap-1 text-sm font-bold">
                    Name this workflow
                    <input
                      className="input font-normal"
                      autoFocus
                      maxLength={60}
                      placeholder={
                        picked.length === 2
                          ? `${NETWORKS[picked[0].provider].label} and ${NETWORKS[picked[1].provider].label}`
                          : "Everyday posts"
                      }
                      value={naming.name}
                      onChange={(event) => setNaming({ ...naming, name: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveWorkflow();
                        }
                      }}
                    />
                    <span className="font-normal text-muted">
                      Keeps these {picked.length} accounts,{" "}
                      {when === "queue" ? "adding to the queue" : "posting straight away"}
                      {product ? `, about ${product.name}` : ""}
                      {trackLinks ? ", with tracked links" : ""}.
                    </span>
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm font-bold">
                      <input
                        type="checkbox"
                        checked={naming.makeDefault}
                        onChange={(event) => setNaming({ ...naming, makeDefault: event.target.checked })}
                      />
                      Start new posts with it
                    </label>
                    <button
                      type="button"
                      className="btn btn-ink btn-sm"
                      disabled={!naming.name.trim() || saver.state !== "idle"}
                      onClick={saveWorkflow}
                    >
                      {saver.state !== "idle" ? "Saving…" : "Save"}
                    </button>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => setNaming(null)}>
                      Cancel
                    </button>
                  </div>
                  {saver.data && "workflowError" in saver.data && (
                    <p className="text-sm font-bold text-hot sm:col-span-2">{saver.data.workflowError}</p>
                  )}
                </div>
              )}

              {picking && accounts.length > 0 && (
                <div className="mt-4 grid gap-4 rounded-2xl bg-sunk p-3 sm:p-4">
                  {brands.map(([brandName, list]) => {
                    const all = list.every((account) => selected.has(account.id));
                    return (
                      <div key={brandName} role="group" aria-label={brandName}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-muted">{brandName}</p>
                          <button
                            type="button"
                            className="text-sm font-bold underline"
                            onClick={() => toggleBrand(list)}
                          >
                            {all ? "None" : "All"}
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {list.map((account) => {
                            const on = selected.has(account.id);
                            const status = on
                              ? checklist.find((entry) => entry.account.id === account.id)?.label
                              : undefined;
                            const reason = status && status.tone !== "ready" ? status.text : null;
                            return (
                              <button
                                key={account.id}
                                type="button"
                                aria-pressed={on}
                                onClick={() => toggle(account.id)}
                                className={`flex min-h-12 items-center gap-2 rounded-2xl py-1.5 pr-3 pl-1.5 text-left transition ${
                                  on
                                    ? status?.tone === "block"
                                      ? "bg-hot/12 ring-2 ring-hot"
                                      : "bg-raised ring-2 ring-ink"
                                    : "bg-ground opacity-80 hover:opacity-100"
                                }`}
                                title={reason ?? account.broken ?? undefined}
                              >
                                <AccountAvatar account={account} size={34} />
                                <span className="leading-tight">
                                  <span className="flex items-center gap-1.5 text-sm font-bold">
                                    <span>{account.displayName}</span>
                                    {account.organizationName && (
                                      <span className="rounded-full bg-sunk px-1.5 py-0.5 text-[0.65rem] font-bold text-muted">
                                        {account.organizationName}
                                      </span>
                                    )}
                                  </span>
                                  <span
                                    className={`block text-xs ${account.broken || status?.tone === "block" ? "text-hot" : "text-muted"}`}
                                  >
                                    {reason ??
                                      (account.broken
                                        ? "Needs reconnecting"
                                        : `${NETWORKS[account.provider].label} · ${account.handle}`)}
                                  </span>
                                </span>
                                {on && status?.tone === "ready" && <Icon name="check" className="size-4" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {organizations.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
                      <span className="font-bold text-muted">Shared organisations:</span>
                      {organizations.map((org) => {
                        const orgAccounts = accounts.filter((acc) => acc.organizationId === org.id);
                        if (orgAccounts.length === 0) return null;
                        const allSelected = orgAccounts.every((acc) => selected.has(acc.id));
                        return (
                          <button
                            key={org.id}
                            type="button"
                            onClick={() => toggleBrand(orgAccounts)}
                            className={`rounded-full px-2.5 py-1 font-bold transition ${
                              allSelected ? "bg-ink text-ground" : "bg-ground text-muted hover:text-ink"
                            }`}
                          >
                            {org.name} ({orgAccounts.length})
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {repostCandidates.length > 0 && (
                    <div className="border-t border-line pt-3">
                      <p className="text-sm font-bold">Repost it with</p>
                      <p className="text-xs text-muted">These share the post instead of writing their own.</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {repostCandidates.map((account) => (
                          <label
                            key={account.id}
                            className="flex min-h-9 cursor-pointer items-center gap-2 rounded-xl bg-ground px-2 text-sm has-checked:bg-ink has-checked:text-ground"
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={reposters.has(account.id)}
                              onChange={(event) =>
                                setReposters((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.add(account.id);
                                  else next.delete(account.id);
                                  return next;
                                })
                              }
                            />
                            <AccountAvatar account={account} size={22} />
                            {account.displayName} · {NETWORKS[account.provider].label}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-muted">
                    Missing one?{" "}
                    <Link to="/settings/autopost" className="font-bold underline">
                      Connect another account
                    </Link>
                    .
                  </p>
                </div>
              )}
            </fieldset>

            {/* 2. What it's about: nothing in particular, or one of your slops. */}
            {products.length > 0 && (
              <div
                className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:px-5"
                role="group"
                aria-label="About"
              >
                <span className="mr-1 text-sm font-bold text-muted">About</span>
                {[{ id: "", name: "Anything" }, ...products].map((item) => (
                  <button
                    key={item.id || "general"}
                    type="button"
                    aria-pressed={productId === item.id}
                    title={
                      item.id ? `Counted with ${item.name} in your analytics` : "A post that isn't about any one slop"
                    }
                    onClick={() => setProductId(item.id)}
                    className={`min-h-8 rounded-full px-3 text-[0.8125rem] font-bold transition ${
                      productId === item.id ? "bg-ink text-ground" : "bg-sunk text-ink hover:bg-line"
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
                {product && !text.trim() && (
                  <button type="button" className="btn btn-slop btn-sm min-h-8" onClick={startFromProduct}>
                    <Icon name="spark" className="size-4" /> Start from {product.name}
                  </button>
                )}
                {product && product.accountIds.length > 0 && !same(product.accountIds) && (
                  <button
                    type="button"
                    className="min-h-8 rounded-full px-2 text-[0.8125rem] font-bold text-muted underline decoration-dotted underline-offset-4 hover:text-ink"
                    onClick={() => pickProduct(product.id)}
                  >
                    Post as {product.name}’s accounts
                  </button>
                )}
              </div>
            )}

            {/* 3. The words: everywhere, or one network's own version. */}
            {providers.size > 0 && (
              <div
                className="scrollbar-none flex gap-1 overflow-x-auto px-3 pt-3 sm:px-4"
                role="group"
                aria-label="Words for"
              >
                {(["all", ...SOCIAL_ORDER.filter((provider) => providers.has(provider))] as const).map((key) => {
                  const on = activeTab === key;
                  const own =
                    key !== "all" &&
                    (Boolean(overrides[key]?.trim()) ||
                      picked.some((account) => account.provider === key && overrides[account.id]?.trim()) ||
                      Boolean(variants[key]));
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        setTab(key);
                        setTabAccount(null);
                        if (key !== "all")
                          setPreviewAccountId(picked.find((account) => account.provider === key)?.id ?? null);
                      }}
                      className={`relative flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-bold transition ${
                        on ? "bg-ink text-ground" : "text-muted hover:bg-sunk hover:text-ink"
                      }`}
                    >
                      {key === "all" ? (
                        "Everywhere"
                      ) : (
                        <>
                          <NetworkBadge provider={key} size="sm" />
                          {NETWORKS[key].label}
                        </>
                      )}
                      {own && <span className="size-1.5 rounded-full bg-slop" aria-label="has its own version" />}
                      {key !== "all" && blockedNetworks.has(key) && (
                        <span className="size-1.5 rounded-full bg-hot" aria-label="needs something" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {activeTab === "all" ? (
              <div className="grid gap-3 p-4 sm:p-5" id="section-post">
                <label htmlFor="studio-text" className="sr-only">
                  Post
                </label>
                <textarea
                  id="studio-text"
                  ref={textArea}
                  className="min-h-40 w-full resize-none bg-transparent text-[1.1875rem] leading-relaxed outline-none placeholder:text-faint [field-sizing:content]"
                  placeholder={
                    product ? `What’s new with ${product.name}?` : "What’s on your mind? Too much slop? Not enough yet!"
                  }
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onPaste={(event) => {
                    const files = [...event.clipboardData.files];
                    if (files.length === 0) return;
                    event.preventDefault();
                    uploads.addFiles(files);
                  }}
                  maxLength={5000}
                />

                {thread.length > 0 && (
                  <ol className="grid gap-3" aria-label="Thread">
                    {thread.map((part, index) => {
                      const used = measureFor(threadNetworks[0] ?? "x")(part);
                      return (
                        <li key={index} className="relative grid gap-1 border-l-2 border-line pl-4">
                          <div className="flex items-center justify-between text-xs text-muted">
                            <span className="font-bold">{index + 2}</span>
                            <span className="flex items-center gap-2">
                              <span className={used > threadLimit ? "font-bold text-hot" : "tabular-nums"}>
                                {used}/{threadLimit}
                              </span>
                              <button
                                type="button"
                                className="grid size-6 place-items-center rounded-full hover:bg-sunk hover:text-ink"
                                aria-label={`Remove post ${index + 2}`}
                                onClick={() => setThread(thread.filter((_, at) => at !== index))}
                              >
                                <Icon name="close" className="size-3.5" />
                              </button>
                            </span>
                          </div>
                          <textarea
                            className="min-h-16 w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-faint [field-sizing:content]"
                            aria-label={`Thread post ${index + 2}`}
                            placeholder="And then…"
                            autoFocus={index === thread.length - 1 && !part}
                            value={part}
                            onChange={(event) =>
                              setThread(thread.map((other, at) => (at === index ? event.target.value : other)))
                            }
                          />
                        </li>
                      );
                    })}
                  </ol>
                )}
                {thread.length > 0 && threadNetworks.length === 0 && providers.size > 0 && (
                  <p className="text-xs text-muted">
                    None of these networks takes threads: they get the first post alone.
                  </p>
                )}

                <MediaTray
                  media={media}
                  setMedia={setMedia}
                  patch={uploads.patch}
                  setError={setUploadError}
                  altText={[...providers].some((provider) => NETWORKS[provider].altText) || providers.size === 0}
                  thumbnail={providers.has("youtube") ? cover : null}
                  onThumbnail={(frame) => void makeThumbnail(frame)}
                />
                {uploadError && <p className="text-sm font-bold text-hot">{uploadError}</p>}

                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-sunk px-3 py-1.5">
                  <Icon name="link" className="size-4 text-muted" />
                  <input
                    className="min-h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
                    type="url"
                    placeholder="Add a link (optional)"
                    aria-label="Link"
                    value={link}
                    onChange={(event) => setLink(event.target.value)}
                  />
                  {link.trim() && (
                    <label
                      className="flex items-center gap-1.5 text-xs font-bold"
                      title="Each network gets its own short link with UTM tags, and the post page counts the clicks."
                    >
                      <input
                        type="checkbox"
                        checked={trackLinks}
                        onChange={(event) => setTrackLinks(event.target.checked)}
                      />
                      Track clicks
                    </label>
                  )}
                </div>

                {commenting && (
                  <label className="grid gap-1 rounded-xl bg-sunk p-3">
                    <span className="flex items-center justify-between gap-2 text-sm font-bold">
                      <span className="flex items-center gap-1.5">
                        <Icon name="chat" className="size-4" /> First comment
                      </span>
                      <button
                        type="button"
                        className="text-xs text-muted underline"
                        onClick={() => {
                          setFirstComment("");
                          setCommenting(false);
                        }}
                      >
                        Remove
                      </button>
                    </span>
                    <span className="text-xs text-muted">
                      {commentNetworks.length
                        ? `Posted under it straight away on ${commentNetworks.map((provider) => NETWORKS[provider].label).join(", ")}. Good for hashtags, a link or a call to action.`
                        : "None of these networks takes a first comment."}
                    </span>
                    <textarea
                      className="min-h-12 w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-faint [field-sizing:content]"
                      value={firstComment}
                      autoFocus={!firstComment}
                      placeholder="#buildinpublic, or where to find it"
                      onChange={(event) => setFirstComment(event.target.value)}
                      maxLength={2000}
                      aria-label="First comment"
                    />
                  </label>
                )}

                {hashtags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-muted">Tap to add:</span>
                    {hashtags.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="rounded-full bg-slop-tint px-2 py-0.5 text-sm font-bold"
                        onClick={() => insert(tag)}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
                {assistError && <p className="text-sm text-hot">{assistError}</p>}
              </div>
            ) : (
              <div className="grid gap-3 p-4 sm:p-5" id="section-post">
                {tabAccounts.length > 1 && (
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="group"
                    aria-label={`Which ${NETWORKS[activeTab].label} accounts`}
                  >
                    {[null, ...tabAccounts.map((account) => account.id)].map((id) => {
                      const account = tabAccounts.find((item) => item.id === id);
                      const on = (editingAccount?.id ?? null) === id;
                      return (
                        <button
                          key={id ?? "network"}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            setTabAccount(id);
                            if (id) setPreviewAccountId(id);
                          }}
                          className={`flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-bold ${
                            on ? "bg-ink text-ground" : "bg-sunk"
                          }`}
                        >
                          {account ? (
                            <>
                              {account.displayName || account.handle}
                              {overrides[account.id]?.trim() && <span className="size-1.5 rounded-full bg-slop" />}
                            </>
                          ) : (
                            `Every ${NETWORKS[activeTab].label} account`
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                <textarea
                  id="studio-words"
                  className="min-h-36 w-full resize-none bg-transparent text-[1.1875rem] leading-relaxed outline-none placeholder:text-faint [field-sizing:content]"
                  aria-label={`Words for ${targetLabel}`}
                  placeholder={text.trim() ? text : `What ${targetLabel} should say`}
                  value={overrides[editingOverrideTarget!] ?? ""}
                  maxLength={
                    editingAccount
                      ? textLimitFor(activeTab, editingAccount)
                      : (limits[activeTab] ?? NETWORKS[activeTab].textLimit)
                  }
                  onChange={(event) => setOverrides({ ...overrides, [editingOverrideTarget!]: event.target.value })}
                />
                <p className="text-xs text-muted">
                  {overrides[editingOverrideTarget!]?.trim()
                    ? `${targetLabel} says this instead of what’s written for everywhere.`
                    : `Empty means ${targetLabel} posts what’s written for everywhere (shown faintly). Type to say it differently here.`}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {!overrides[editingOverrideTarget!]?.trim() && text.trim() && (
                    <button
                      type="button"
                      className="min-h-8 rounded-full bg-sunk px-3 text-[0.8125rem] font-bold hover:bg-line"
                      onClick={() => setOverrides({ ...overrides, [editingOverrideTarget!]: text })}
                    >
                      Start from everywhere’s words
                    </button>
                  )}
                  {canAssist && (
                    <button
                      type="button"
                      className="flex min-h-8 items-center gap-1.5 rounded-full bg-sunk px-3 text-[0.8125rem] font-bold hover:bg-line disabled:opacity-50"
                      disabled={assisting !== null || !text.trim()}
                      onClick={() => void runAssist("adapt")}
                    >
                      <Icon name="spark" className="size-3.5" />
                      {assisting === "adapt" ? "Writing…" : `Write it for ${targetLabel}`}
                    </button>
                  )}
                </div>
                {assistError && <p className="text-sm text-hot">{assistError}</p>}
                <VariantFields
                  target={editingOverrideTarget!}
                  label={targetLabel}
                  variant={variants[editingOverrideTarget!]}
                  sharedLink={link}
                  sharedComment={firstComment}
                  comments={NETWORKS[activeTab].firstComment}
                  media={media}
                  onChange={(change) => setVariant(editingOverrideTarget!, change)}
                  onReset={() => {
                    setVariant(editingOverrideTarget!, null);
                    setOverrides({ ...overrides, [editingOverrideTarget!]: undefined });
                  }}
                />
                {(activeTab === "youtube" ||
                  activeTab === "tiktok" ||
                  activeTab === "instagram" ||
                  (activeTab === "linkedin" && !!shape.documents)) && (
                  <div className="grid gap-4 rounded-2xl bg-sunk p-4" id="studio-network-options">
                    {activeTab === "youtube" && <YouTubeFields value={youtube} onChange={setYouTube} />}
                    {activeTab === "tiktok" && (
                      <TikTokFields
                        value={tiktokOptions}
                        onChange={setTikTok}
                        accounts={picked.filter((account) => account.provider === "tiktok")}
                        info={tiktok}
                      />
                    )}
                    {activeTab === "instagram" && (
                      <fieldset className="grid gap-2">
                        <legend className="font-bold">Post it as</legend>
                        <Segmented
                          name="instagram-format"
                          value={instagramFormat}
                          onChange={setInstagramFormat}
                          options={[
                            { value: "feed", label: video ? "Reel" : "Feed post" },
                            { value: "story", label: "Story" },
                          ]}
                        />
                        {instagramFormat === "feed" && (
                          <label className="grid gap-1 text-sm font-bold">
                            Collaborators (up to 3)
                            <input
                              className="input font-normal"
                              placeholder="tiltmaze.app, slopperday"
                              value={collaborators}
                              onChange={(event) => setCollaborators(event.target.value)}
                            />
                          </label>
                        )}
                      </fieldset>
                    )}
                    {activeTab === "linkedin" && !!shape.documents && (
                      <label className="grid gap-1 text-sm font-bold">
                        Document title on LinkedIn
                        <input
                          className="input font-normal"
                          maxLength={200}
                          value={documentTitle}
                          onChange={(event) => setDocumentTitle(event.target.value)}
                        />
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 4. The tools */}
            <div
              className="flex flex-wrap items-center gap-1 border-t border-line px-2 py-2 sm:px-3"
              id="studio-media-tools"
              role="toolbar"
              aria-label="Add to the post"
            >
              <input
                ref={pictureInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                hidden
                onChange={(event) => {
                  void uploads.addPictures([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
              />
              <input
                ref={videoInput}
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                hidden
                onChange={(event) => {
                  void uploads.addVideo(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <input
                ref={pdfInput}
                type="file"
                accept="application/pdf"
                hidden
                onChange={(event) => {
                  void uploads.addDocument(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              <ToolButton
                icon="image"
                label="Pictures"
                disabled={!uploads.canAddPictures}
                onClick={() => pictureInput.current?.click()}
              />
              <ToolButton
                icon="play"
                label="Video"
                disabled={!uploads.canAddOne}
                onClick={() => videoInput.current?.click()}
              />
              {providers.has("linkedin") && (
                <ToolButton
                  icon="page"
                  label="PDF"
                  disabled={!uploads.canAddOne}
                  onClick={() => pdfInput.current?.click()}
                />
              )}
              <ToolButton
                icon="thread"
                label="Add to thread"
                onClick={() => {
                  setTab("all");
                  setThread([...thread, ""]);
                }}
              />
              {!commenting && (
                <ToolButton
                  icon="chat"
                  label="First comment"
                  onClick={() => {
                    setTab("all");
                    setCommenting(true);
                  }}
                />
              )}
              {snippets.some((snippet) => snippet.kind !== "reply") && (
                <Menu icon="hash" label="Snippets">
                  {snippets
                    .filter((snippet) => snippet.kind !== "reply")
                    .map((snippet) => (
                      <MenuItem
                        key={snippet.id}
                        onClick={() => {
                          setTab("all");
                          if (snippet.kind === "template") setText(snippet.text);
                          else insert(snippet.text);
                        }}
                      >
                        <span className="font-bold">{snippet.name}</span>
                        <span className="block truncate text-xs text-muted">{snippet.text}</span>
                      </MenuItem>
                    ))}
                  <p className="border-t border-line px-3 pt-2 pb-1 text-xs text-muted">
                    Variables:{" "}
                    {Object.keys(VARIABLES)
                      .map((name) => `{${name}}`)
                      .join(" ")}
                    . Spintax: {"{Hi|Hello}"} gives each account one.{" "}
                    <Link to="/studio/settings" className="underline">
                      Manage
                    </Link>
                  </p>
                </Menu>
              )}
              {canAssist && (
                <Menu
                  icon="spark"
                  label={assisting ? "Writing…" : "Assist"}
                  disabled={!text.trim() || assisting !== null}
                >
                  {(["shorten", "expand", "rephrase", "punchier", "hashtags", "thread"] as const).map((name) => (
                    <MenuItem key={name} onClick={() => void runAssist(name)}>
                      {ASSIST_ACTIONS[name]}
                    </MenuItem>
                  ))}
                  {brand && (
                    <p className="border-t border-line px-3 pt-2 pb-1 text-xs text-muted">In {brand}’s voice.</p>
                  )}
                </Menu>
              )}
              {threadNetworks.length > 0 && text.trim() && (
                <ToolButton icon="sync" label="Split to fit" onClick={autoSplit} />
              )}
              <div className="ml-auto">
                <Counters providers={providers} text={text} link={link} overrides={overrides} limits={limits} />
              </div>
            </div>
          </div>

          {/* 5. When, and send. */}
          {when === "later" && (
            <div className="grid gap-3 rounded-2xl bg-sunk p-4">
              {picked.length > 1 && (
                <Segmented
                  name="time-mode"
                  value={timeMode}
                  onChange={setTimeMode}
                  options={[
                    { value: "same", label: "Same time for all" },
                    { value: "each", label: "Choose per account" },
                  ]}
                />
              )}
              {timeMode === "each" && picked.length > 1 ? (
                <ul className="grid gap-2" aria-label="Time for each account">
                  {picked.map((account) => (
                    <li key={account.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <AccountAvatar account={account} size={26} />
                      <span className="w-40 truncate font-bold">{account.handle}</span>
                      <input
                        type="datetime-local"
                        className="input min-h-9 w-auto py-1"
                        aria-label={`When ${account.handle} posts`}
                        value={times[account.id] ?? ""}
                        onChange={(event) => setTimes({ ...times, [account.id]: event.target.value })}
                      />
                      {(bestByAccount[account.id] ?? []).slice(0, 2).map((slot) => (
                        <button
                          key={`${slot.day}-${slot.minute}`}
                          type="button"
                          className="rounded-full bg-ground px-2 py-0.5 text-xs font-bold hover:bg-line"
                          title={
                            slot.reason === "yours"
                              ? "From this account's own results: an estimate."
                              : "A typical good time: an estimate."
                          }
                          onClick={() => setTimes({ ...times, [account.id]: localInput(slot.at, timeZone) })}
                        >
                          {DAYS[slot.day]} {hhmm(slot.minute)}
                        </button>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    className="input w-auto"
                    aria-label="When it goes out"
                    value={scheduledAt}
                    onChange={(event) => setScheduledAt(event.target.value)}
                  />
                  <span className="text-sm font-bold text-muted">
                    {best[0]?.reason === "yours" ? "Your best times:" : "Good times:"}
                  </span>
                  {best.map((slot) => (
                    <button
                      key={`${slot.day}-${slot.minute}`}
                      type="button"
                      className="rounded-full bg-ground px-2.5 py-1 text-sm font-bold hover:bg-line"
                      title="An estimate"
                      onClick={() => setScheduledAt(localInput(slot.at, timeZone))}
                    >
                      {DAYS[slot.day]} {hhmm(slot.minute)}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-2 font-bold">
                  Repeat
                  <select
                    className="input min-h-9 py-1 font-normal"
                    value={repeatDays}
                    onChange={(event) => setRepeatDays(Number(event.target.value))}
                  >
                    {REPEATS.map((option) => (
                      <option key={option.days} value={option.days}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {repeatDays > 0 && (
                  <label className="flex items-center gap-2 font-bold">
                    times
                    <input
                      type="number"
                      min={1}
                      max={52}
                      className="input min-h-9 w-20 py-1"
                      value={repeatTimes}
                      onChange={(event) => setRepeatTimes(Number(event.target.value))}
                    />
                  </label>
                )}
                <span className="text-xs text-muted">
                  Times are in {timeZone}.{" "}
                  <Link to="/settings" className="underline">
                    Change
                  </Link>
                </span>
              </div>
            </div>
          )}

          <div className="sticky bottom-3 z-20 grid gap-3 rounded-2xl bg-ink p-3 text-ground shadow-lg sm:p-4 lg:static lg:shadow-none">
            {(problems.length > 0 || actionData?.error || !canPost) && picked.length > 0 && (
              <ul className="grid gap-0.5 text-sm text-ground/80" role="status">
                {!canPost && <li>Posting needs the content check, and it isn’t set up on this server.</li>}
                {actionData && "error" in actionData && actionData.error && (
                  <li className="font-bold text-hot">{actionData.error}</li>
                )}
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
            <p className="text-sm text-ground/75 max-sm:hidden">
              {when === "queue"
                ? nextQueueAt
                  ? `Next free time: ${clock(nextQueueAt)}.`
                  : "Your queue is full for four weeks."
                : when === "later"
                  ? scheduledAt
                    ? `Goes out ${clock(wallTime(scheduledAt, timeZone) ?? previewTime)}.`
                    : "Pick a time above."
                  : picked.length === 0
                    ? "Pick who it’s from, or save it as an idea."
                    : blocked.length
                      ? `${blocked.length} account${blocked.length === 1 ? " needs" : "s need"} something first.`
                      : "Checked before anything goes out."}
              {when === "queue" && (
                <>
                  {" "}
                  <Link to="/studio/settings" className="underline">
                    Queue times
                  </Link>
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-xl bg-ground/10 p-1" role="radiogroup" aria-label="When">
                {(
                  [
                    { value: "now", label: "Now" },
                    { value: "queue", label: "Queue" },
                    { value: "later", label: "Pick a time" },
                  ] as const
                ).map((option) => (
                  <label key={option.value} className="cursor-pointer">
                    <input
                      type="radio"
                      name="ui-when"
                      value={option.value}
                      checked={when === option.value}
                      onChange={() => setWhen(option.value)}
                      className="peer sr-only"
                    />
                    <span className="flex min-h-9 items-center rounded-lg px-3 text-sm font-bold text-ground/70 peer-checked:bg-ground peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-(--focus)">
                      {option.label}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  name="submit"
                  value="draft"
                  className="btn btn-sm bg-ground/10 text-ground hover:bg-ground/20"
                  disabled={!canDraft || sending}
                >
                  {picked.length === 0 ? "Save as an idea" : "Save draft"}
                </button>
                <button
                  ref={submitButton}
                  type="submit"
                  name="submit"
                  value={when === "now" ? "now" : when === "queue" ? "queue" : "schedule"}
                  className="btn btn-slop"
                  disabled={!ready || sending}
                  title="⌘ Enter"
                >
                  <Icon name={when === "now" ? "send" : "calendar"} className="size-4" />
                  {sending ? "Checking…" : picked.length === 0 ? "Pick accounts" : `${verb} ${count}`}
                </button>
              </div>
            </div>
          </div>
          {/* 6. The rarely needed */}
          <details
            className="rounded-2xl bg-sunk px-4 py-3"
            open={extras}
            onToggle={(event) => setExtras(event.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm font-bold">More options</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1 text-sm font-bold">
                Tags
                <input
                  className="input font-normal"
                  placeholder="launch, tiltmaze"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                />
                <span className="font-normal text-muted">
                  For filters and analytics. The first names the UTM campaign.
                </span>
              </label>
              <label className="grid gap-1 text-sm font-bold">
                Note to self
                <textarea
                  className="input min-h-16 font-normal"
                  placeholder="Only you see this."
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={2000}
                />
              </label>
              {picked.length > 1 && (
                <label className="grid gap-1 text-sm font-bold">
                  Space the accounts out
                  <select
                    className="input font-normal"
                    value={stagger}
                    onChange={(event) => setStagger(Number(event.target.value))}
                  >
                    {[0, 5, 15, 30, 60, 120].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes === 0 ? "All at once" : `${minutes} minutes apart`}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {threadNetworks.length > 0 && (
                <div className="grid content-start gap-2">
                  <label className="flex items-center gap-2 text-sm font-bold">
                    <input type="checkbox" checked={plugOn} onChange={(event) => setPlugOn(event.target.checked)} />
                    Auto-plug: reply when it takes off
                  </label>
                  {plugOn && (
                    <div className="grid gap-2 sm:grid-cols-[6rem_1fr]">
                      <label className="grid gap-1 text-xs font-bold">
                        At likes
                        <input
                          type="number"
                          min={1}
                          className="input"
                          value={plugLikes}
                          onChange={(event) => setPlugLikes(Number(event.target.value))}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-bold">
                        Reply with
                        <input
                          className="input"
                          placeholder="If you liked this, Tiltmaze is free on iOS →"
                          value={plugText}
                          onChange={(event) => setPlugText(event.target.value)}
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          </details>
        </div>

        {/* Where it's going and how it looks there. */}
        <aside className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:sticky lg:top-20" aria-label="Previews">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-[1.6rem] leading-none font-extrabold">Preview</h2>
            <span className="text-xs text-muted">Close to how each network shows it</span>
          </div>
          {previews.length === 0 ? (
            <div className="grid place-items-center gap-2 rounded-3xl bg-sunk p-8 text-center text-muted">
              <Icon name="eye" className="size-8" />
              <p>Choose who it’s from, and you’ll see it here as each network shows it.</p>
            </div>
          ) : (
            <>
              <ul className="grid gap-1 rounded-2xl bg-sunk p-1.5" aria-label="Checklist">
                {checklist.map(({ account, issues, label }) => {
                  const firstFix = issues.find((issue) => issue.level !== "info");
                  const on = activePreview?.account.id === account.id;
                  return (
                    <li
                      key={account.id}
                      className={`grid gap-0.5 rounded-xl px-2 py-1.5 text-sm ${on ? "bg-raised" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          aria-pressed={on}
                          aria-label={`${NETWORKS[account.provider].label}: ${account.handle}`}
                          onClick={() => setPreviewAccountId(account.id)}
                        >
                          <AccountAvatar account={account} size={26} />
                          <span className="min-w-0 truncate font-bold">{account.handle}</span>
                        </button>
                        <span
                          className={`flex shrink-0 items-center gap-1 text-xs font-bold ${
                            label.tone === "ready"
                              ? empty
                                ? "text-muted"
                                : "text-slop-text"
                              : label.tone === "block"
                                ? "text-hot"
                                : "text-ink"
                          }`}
                        >
                          {label.tone === "ready" && !empty ? <Icon name="check" className="size-3.5" /> : null}
                          {label.tone === "ready"
                            ? empty
                              ? "Waiting for words"
                              : "Ready"
                            : label.tone === "block"
                              ? "Needs a fix"
                              : "Check"}
                        </span>
                      </div>
                      {label.tone !== "ready" && (
                        <p className="flex flex-wrap items-center gap-x-2 pl-8 text-xs">
                          <span className={label.tone === "block" ? "text-hot" : "text-muted"}>{label.text}</span>
                          {firstFix && firstFix.field !== "link" && (
                            <button
                              type="button"
                              className="font-bold underline"
                              onClick={() => fix(account, firstFix)}
                            >
                              {firstFix.field === "account" ? "Reconnect" : "Fix"}
                            </button>
                          )}
                          {label.tone === "block" && (
                            <button
                              type="button"
                              className="font-bold text-muted underline"
                              onClick={() => toggle(account.id)}
                            >
                              Leave it out
                            </button>
                          )}
                        </p>
                      )}
                      {issues
                        .filter((issue) => issue.level === "info")
                        .map((issue) => (
                          <span key={issue.message} className="pl-8 text-xs text-muted">
                            {issue.message}
                          </span>
                        ))}
                    </li>
                  );
                })}
              </ul>
              {activePreview && (
                <div className="mx-auto w-full max-w-[460px]">
                  <PostPreview
                    key={activePreview.account.id}
                    account={activePreview.account}
                    text={activePreview.fitted}
                    title={activePreview.account.provider === "youtube" ? youtube.title || "Untitled video" : undefined}
                    media={activePreview.media}
                    over={activePreview.over}
                    instagramFormat={instagramFormat}
                    replies={activePreview.replies}
                    firstComment={activePreview.firstComment}
                  />
                </div>
              )}
            </>
          )}
          <p className="text-xs text-muted">
            Tip: drop or paste pictures into the post, and press <kbd className="font-bold">⌘ Enter</kbd> to send.
          </p>
        </aside>
      </Form>

      <div className="mt-16 flex flex-wrap items-center justify-between gap-3">
        <h2 className="title-2">Your posts</h2>
        <nav className="inline-flex rounded-xl bg-sunk p-1" aria-label="Show">
          {(["all", "drafts", "scheduled", "failed"] as const).map((name) => (
            <Link
              key={name}
              to={`?show=${name}`}
              preventScrollReset
              className={`flex min-h-9 items-center rounded-lg px-3 font-bold capitalize ${filter === name ? "bg-ink text-ground" : "text-muted"}`}
            >
              {name}
            </Link>
          ))}
        </nav>
      </div>
      {listed.length === 0 ? (
        <p className="mt-4 rounded-2xl bg-sunk p-6 text-center text-muted">
          {filter === "all"
            ? "Nothing yet. Your first post will show up here, with how it did on each network."
            : "Nothing here."}
        </p>
      ) : (
        <ul className="mt-5 grid gap-2">
          {listed.map((post) => {
            const totals = sumMetrics(post.deliveries.map((row) => row.metrics));
            const scheduled = post.scheduledAt !== null && !post.released && !post.cancelled;
            return (
              <li key={post.id}>
                <Link
                  to={`/studio/posts/${post.id}`}
                  className="flex flex-wrap items-center gap-4 rounded-2xl bg-sunk p-4 transition hover:bg-line"
                >
                  {post.media[0]?.url &&
                    (post.media[0].kind === "video" ? (
                      <video
                        src={post.media[0].url}
                        className="size-14 rounded-xl object-cover"
                        muted
                        preload="metadata"
                      />
                    ) : post.media[0].kind === "image" ? (
                      <img src={post.media[0].url} alt="" className="size-14 rounded-xl object-cover" />
                    ) : null)}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-bold">
                      {post.draft && <span className="mr-2 rounded-full bg-ground px-2 py-0.5 text-xs">Draft</span>}
                      {post.text || post.options.youtube?.title || "Untitled"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {post.deliveries.map((row) => (
                        <span key={row.id} className="flex items-center gap-1">
                          <NetworkBadge provider={row.provider} size="sm" />
                          <StatusPill status={row.status} scheduled={scheduled && !post.draft} draft={post.draft} />
                        </span>
                      ))}
                      {post.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-ground px-2 text-xs font-bold text-muted">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <p className="text-muted">
                      {post.draft
                        ? "Not sent"
                        : scheduled
                          ? `Goes out ${new Date(post.scheduledAt!).toLocaleString("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" })}`
                          : new Date(post.createdAt).toLocaleDateString("en-GB", { timeZone })}
                    </p>
                    <p className="mt-1 font-bold tabular-nums">
                      {formatCount(totals.views)} views · {formatCount(totals.likes)} likes ·{" "}
                      {formatCount(totals.comments)} comments
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface QuickSet {
  key: string;
  label: string;
  ids: readonly string[];
  /** New posts start with it. */
  starred: boolean;
  apply: () => void;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function ToolButton({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-bold text-muted transition hover:bg-sunk hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} className="size-4.5" />
      <span className="max-sm:sr-only">{label}</span>
    </button>
  );
}

/** A small menu off the toolbar. Picking an item closes it. */
function Menu({
  icon,
  label,
  disabled = false,
  children,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <details
      ref={ref}
      className="relative"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("[data-menu-item]") && ref.current) ref.current.open = false;
      }}
    >
      <summary
        className={`flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2.5 text-sm font-bold text-muted transition hover:bg-sunk hover:text-ink [&::-webkit-details-marker]:hidden ${disabled ? "pointer-events-none opacity-40" : ""}`}
        aria-disabled={disabled}
      >
        <Icon name={icon} className="size-4.5" />
        <span className="max-sm:sr-only">{label}</span>
        <Icon name="chevron" className="size-3.5" />
      </summary>
      <div className="absolute bottom-full left-0 z-30 mb-2 grid w-72 gap-0.5 rounded-2xl bg-raised p-1.5 shadow-xl ring-1 ring-line">
        {children}
      </div>
    </details>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      data-menu-item
      className="rounded-xl px-3 py-2 text-left text-sm font-bold hover:bg-sunk"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** The first visit: what the studio does, and the one step before it can post. */
function GetStarted() {
  const networks: SocialProvider[] = [
    "x",
    "linkedin",
    "bluesky",
    "threads",
    "instagram",
    "facebook",
    "tiktok",
    "youtube",
    "mastodon",
    "reddit",
  ];
  return (
    <div className="mt-8 grid gap-6 rounded-3xl bg-slop-tint p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
      <div>
        <h2 className="title-3">Post everywhere from one place</h2>
        <ol className="mt-4 grid gap-2 text-[1.0625rem]">
          <li>
            <strong>1. Connect where you post.</strong> As many accounts and brands as you like.
          </li>
          <li>
            <strong>2. Write it once.</strong> Each network gets a copy that fits, and you can tweak any of them.
          </li>
          <li>
            <strong>3. Send it now, queue it or pick a time.</strong> Next time, your usual accounts are already picked.
          </li>
        </ol>
        <p className="mt-4 text-sm text-muted">
          Free on every network. X charges for its API, so X posts use your own X developer credits.
        </p>
        <Link to="/settings/autopost" className="btn btn-ink mt-5">
          <Icon name="plus" className="size-4" /> Connect your first account
        </Link>
      </div>
      <ul className="grid grid-cols-5 gap-3" aria-label="Networks you can post to">
        {networks.map((provider) => (
          <li key={provider} title={NETWORKS[provider].label}>
            <NetworkBadge provider={provider} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export type { TikTokOptions };
