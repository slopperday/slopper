import { useEffect, useMemo, useState } from "react";
import { Form, Link, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/studio";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { config } from "~/.server/config";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { modeFor } from "~/.server/social/crosspost";
import { bestTimes, nextAt, saveStudioPost, type StudioInput } from "~/.server/social/studio";
import { type CreatorInfo, creatorInfo } from "~/.server/social/tiktok";
import { ASSIST_ACTIONS, type AssistAction } from "~/lib/assist";
import { fitPost, measureFor } from "~/lib/compose";
import { slopPath } from "~/lib/display";
import {
  INSTAGRAM_FORMATS,
  NETWORKS,
  type NetworkOptions,
  optionProblems,
  type PostShape,
  type SocialProvider,
  textLimitFor,
  TIKTOK_PRIVACY,
  type TikTokOptions,
  unsupportedReason,
  YOUTUBE_PRIVACY,
  type YouTubeOptions,
} from "~/lib/networks";
import { splitThread } from "~/lib/thread";
import { VARIABLES } from "~/lib/variables";
import { seo } from "~/lib/seo";
import { Icon } from "~/components/Icon";
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
  MediaPicker,
  Segmented,
  SOCIAL_ORDER,
  TikTokFields,
  uploadPicture,
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
  const [accounts, slops, posts, snippets, settings, sent, editing] = await Promise.all([
    convex.query(api.accounts.list, { userId: user._id }),
    convex.query(api.slops.listForServer, { userId: user._id }),
    convex.query(api.social.list, { userId: user._id, limit: 30 }),
    convex.query(api.studio.snippets, { userId: user._id }),
    convex.query(api.studio.settings, { userId: user._id }),
    convex.query(api.social.sent, { userId: user._id, since: Date.now() - 90 * DAY }),
    editId ? convex.query(api.social.get, { userId: user._id, postId: editId }) : null,
  ]);
  const copy = copyId ? await convex.query(api.social.get, { userId: user._id, postId: copyId }) : null;

  // One entry per product, from its newest launch: its name, link, screenshots and the accounts it posts as.
  const products = new Map<
    string,
    { id: string; name: string; tagline: string; url: string; screenshots: string[]; accountIds: string[] }
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
    accounts: accounts.map(({ _id, provider, handle, displayName, avatarUrl, brand, broken, longPosts }) => ({
      id: _id,
      provider,
      handle,
      displayName,
      avatarUrl,
      brand: brand ?? null,
      broken: broken ?? null,
      longPosts: longPosts ?? false,
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
    editing: editing && editing.editable ? editing : null,
    copy,
    prefill: { text: search.get("text") ?? "", link: search.get("link") ?? "" },
    canPost: config.contentCheck !== null,
    canAssist: config.contentCheck !== null,
    timeZone: user.timeZone,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
  if (formText(form, "intent") === "discard") {
    await convex.mutation(api.social.discard, { userId: user._id, postId: formText(form, "postId") });
    return redirectWithFlash("/studio", { tone: "info", message: "Draft deleted." });
  }
  let input: StudioInput;
  try {
    input = parsePayload(formText(form, "payload"), formText(form, "submit"));
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
function parsePayload(raw: string, submit: string): StudioInput {
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
    scheduledAt: submit === "schedule" ? (num(value.scheduledAt) ?? null) : null,
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

export default function Studio({ loaderData, actionData }: Route.ComponentProps) {
  const { accounts, products, posts, tiktok, canPost, canAssist, snippets, best, editing, prefill, paused, timeZone } =
    loaderData;
  const navigation = useNavigation();
  const sending = navigation.state !== "idle" && navigation.formMethod === "POST";
  const [params] = useSearchParams();

  const signature = snippets.find((snippet) => snippet.autoAdd);
  // Editing keeps the post; "Use again" starts a new one from a copy of it.
  const base = editing ?? loaderData.copy;
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(base?.deliveries.filter((row) => !row.repost).map((row) => row.accountId) ?? []),
  );
  const [reposters, setReposters] = useState<ReadonlySet<string>>(
    new Set(base?.deliveries.filter((row) => row.repost).map((row) => row.accountId) ?? []),
  );
  const [productId, setProductId] = useState(base?.product?.id ?? "");
  const [text, setText] = useState(
    base?.text ?? (prefill.text ? prefill.text : signature ? `\n\n${signature.text}` : ""),
  );
  const [link, setLink] = useState(base?.link ?? prefill.link);
  const [overrides, setOverrides] = useState<Partial<Record<SocialProvider, string>>>(base?.overrides ?? {});
  const [editingNetwork, setEditingNetwork] = useState<SocialProvider | null>(null);
  const [thread, setThread] = useState<string[]>(base?.thread ?? []);
  const [firstComment, setFirstComment] = useState(base?.firstComment ?? "");
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
  const [when, setWhen] = useState<"now" | "queue" | "later">(editing?.scheduledAt ? "later" : "now");
  const [scheduledAt, setScheduledAt] = useState(editing?.scheduledAt ? localInput(editing.scheduledAt, timeZone) : "");
  const [repeatDays, setRepeatDays] = useState(base?.repeat?.everyDays ?? 0);
  const [repeatTimes, setRepeatTimes] = useState(base?.repeat?.remaining ?? 4);
  const [stagger, setStagger] = useState(base?.staggerMinutes ?? 0);
  const [plugOn, setPlugOn] = useState(!!base?.plug);
  const [plugLikes, setPlugLikes] = useState(base?.plug?.likes ?? 50);
  const [plugText, setPlugText] = useState(base?.plug?.text ?? "");
  const [trackLinks, setTrackLinks] = useState(base?.trackLinks ?? false);
  const [tags, setTags] = useState((base?.tags ?? []).join(", "));
  const [note, setNote] = useState(base?.note ?? "");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [assisting, setAssisting] = useState<AssistAction | null>(null);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [extras, setExtras] = useState(
    Boolean(base?.firstComment || base?.note || base?.tags.length || base?.repeat || base?.plug),
  );

  // A product picked from a link (?product=) starts with its accounts.
  useEffect(() => {
    const id = params.get("product");
    if (id && !editing) pickProduct(id);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival.
  }, []);

  const picked = accounts.filter((account) => selected.has(account.id));
  const providers = new Set(picked.map((account) => account.provider));
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
  const blocked = picked
    .map((account) => ({ account, reason: unsupportedReason(account.provider, shape) }))
    .filter((item): item is { account: (typeof picked)[number]; reason: string } => item.reason !== null);
  const problems = [
    ...optionProblems(providers, options),
    ...(!text.trim() && media.length === 0 ? ["Write something or add a picture or video."] : []),
    ...(when === "later" && !scheduledAt ? ["Pick when it goes out."] : []),
  ];
  const ready = canPost && picked.length > 0 && blocked.length === 0 && problems.length === 0 && !uploading;
  const canDraft = picked.length > 0 && !uploading && (text.trim() || media.length > 0);

  const brands = useMemo(() => {
    const groups = new Map<string, ComposerAccount[]>();
    for (const account of accounts) {
      const name = account.brand ?? "No brand yet";
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
    const product = products.find((item) => item.id === id);
    if (product) setSelected(new Set(product.accountIds));
  }

  /** Starts the post from the product: its tagline, its Slopper page and its screenshots. */
  function startFromProduct() {
    const product = products.find((item) => item.id === productId);
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

  async function runAssist(action: AssistAction) {
    setAssisting(action);
    setAssistError(null);
    try {
      const response = await fetch("/api/studio/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          text: editingNetwork ? overrides[editingNetwork] || text : text,
          network: action === "adapt" ? editingNetwork : null,
          brand,
        }),
      });
      const body = (await response.json()) as { text?: string; posts?: string[]; hashtags?: string[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "The assistant didn't answer.");
      if (body.posts?.length) {
        setText(body.posts[0]);
        setThread(body.posts.slice(1));
      } else if (body.hashtags) setHashtags(body.hashtags);
      else if (body.text && action === "adapt" && editingNetwork)
        setOverrides({ ...overrides, [editingNetwork]: body.text });
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
    scheduledAt: scheduledAt ? new Date(scheduledAt).getTime() : null,
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

  // One preview per network picked, for its first account.
  const readyMedia = media
    .filter((item) => item.id && item.kind !== "document")
    .map(({ kind, url }) => ({ kind: kind as "image" | "video", url }));
  const previews = SOCIAL_ORDER.filter((provider) => providers.has(provider)).map((provider) => {
    const account = picked.find((item) => item.provider === provider)!;
    const words = overrides[provider]?.trim() || text;
    const limit = limits[provider] ?? NETWORKS[provider].textLimit;
    const fitted = fitPost(provider, words, link.trim() || null);
    const measure = measureFor(provider);
    const suffix = link.trim() ? measure(`\n\n${link.trim()}`) : 0;
    return { account, fitted, over: measure(words.trim()) + suffix > limit };
  });
  const filter = params.get("show") ?? "all";
  const listed = posts.filter((post) => {
    const scheduled = post.scheduledAt !== null && !post.released && !post.cancelled && !post.draft;
    if (filter === "drafts") return post.draft;
    if (filter === "scheduled") return scheduled;
    if (filter === "failed") return post.deliveries.some((row) => row.status === "error");
    return true;
  });
  const broken = accounts.filter((account) => account.broken);

  return (
    <section className="mx-auto max-w-6xl px-4 pt-10 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="title-1">Studio</h1>
          <p className="lede mt-3 max-w-2xl">
            Write it once. Pick the accounts, and each network gets a copy that fits it, as whichever brand it’s for.
          </p>
        </div>
      </div>
      <div className="mt-8">
        <StudioNav />
      </div>

      {paused && (
        <p className="mt-6 rounded-2xl border-2 border-hot p-4" role="status">
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

      {accounts.length === 0 ? (
        <div className="panel mt-8 max-w-2xl">
          <h2 className="title-3">Connect an account first</h2>
          <p className="mt-2 text-muted">
            Connect X, LinkedIn, Bluesky, Threads, Facebook Pages, Instagram, TikTok or YouTube. You can connect as many
            brands as you like.
          </p>
          <Link to="/settings/autopost" className="btn btn-slop mt-4">
            Connect accounts
          </Link>
        </div>
      ) : (
        <Form method="post" className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <input type="hidden" name="payload" value={payload} />
          <div className="grid gap-5">
            {editing && (
              <p className="rounded-2xl bg-raised p-3 text-sm">
                Editing {editing.draft ? "a draft" : "a scheduled post"}.{" "}
                <Link to="/studio" className="underline">
                  Start a new one instead
                </Link>
              </p>
            )}
            {/* 1. Who it's from */}
            <fieldset className="panel">
              <legend className="sr-only">Post as</legend>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-[1.6rem] leading-none font-extrabold">Post as</h2>
                {products.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm font-bold">
                      For
                      <select
                        className="input min-h-10 py-1"
                        value={productId}
                        onChange={(event) => pickProduct(event.target.value)}
                      >
                        <option value="">No product</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {productId && (
                      <button type="button" className="btn btn-quiet btn-sm" onClick={startFromProduct}>
                        Start from it
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="mt-4 grid gap-4">
                {brands.map(([brandName, list]) => {
                  const all = list.every((account) => selected.has(account.id));
                  return (
                    <div key={brandName} role="group" aria-label={brandName}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-muted">{brandName}</p>
                        <button type="button" className="text-sm font-bold underline" onClick={() => toggleBrand(list)}>
                          {all ? "None" : "All"}
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {list.map((account) => {
                          const on = selected.has(account.id);
                          const reason = on ? unsupportedReason(account.provider, shape) : null;
                          return (
                            <button
                              key={account.id}
                              type="button"
                              aria-pressed={on}
                              onClick={() => toggle(account.id)}
                              className={`flex min-h-12 items-center gap-2 rounded-2xl border-2 py-1.5 pr-3 pl-1.5 text-left transition ${
                                on
                                  ? reason
                                    ? "border-hot bg-hot/10"
                                    : "border-ink bg-raised"
                                  : "border-line opacity-70 hover:opacity-100"
                              }`}
                              title={reason ?? account.broken ?? undefined}
                            >
                              <AccountAvatar account={account} size={34} />
                              <span className="leading-tight">
                                <span className="block text-sm font-bold">{account.displayName}</span>
                                <span className={`block text-xs ${account.broken ? "text-hot" : "text-muted"}`}>
                                  {reason ??
                                    (account.broken
                                      ? "Needs reconnecting"
                                      : `${NETWORKS[account.provider].label} · ${account.handle}`)}
                                </span>
                              </span>
                              {on && !reason && <Icon name="check" className="size-4" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              {repostCandidates.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="text-sm font-bold">Repost it with</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {repostCandidates.map((account) => (
                      <label
                        key={account.id}
                        className="flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border border-line px-2 text-sm has-checked:border-ink has-checked:bg-raised"
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
            </fieldset>

            {/* 2. What it says */}
            <div className="panel">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="font-display text-[1.6rem] leading-none font-extrabold" htmlFor="studio-text">
                  Post
                </label>
                {snippets.length > 0 && (
                  <select
                    className="input min-h-9 w-auto py-1 text-sm"
                    value=""
                    aria-label="Insert a snippet"
                    onChange={(event) => {
                      const snippet = snippets.find((item) => item.id === event.target.value);
                      if (!snippet) return;
                      if (snippet.kind === "template") setText(snippet.text);
                      else insert(snippet.text);
                    }}
                  >
                    <option value="">Insert a snippet…</option>
                    {snippets
                      .filter((snippet) => snippet.kind !== "reply")
                      .map((snippet) => (
                        <option key={snippet.id} value={snippet.id}>
                          {snippet.kind === "hashtags" ? "#" : snippet.kind === "template" ? "▤" : "✎"} {snippet.name}
                        </option>
                      ))}
                  </select>
                )}
              </div>
              <textarea
                id="studio-text"
                className="input mt-3 min-h-40 text-[1.0625rem]"
                placeholder="What did you ship? Too much slop? Not enough yet!"
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={5000}
              />
              <Counters providers={providers} text={text} link={link} overrides={overrides} limits={limits} />
              {canAssist && (
                <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Writing assistant">
                  <span className="text-sm font-bold">
                    <Icon name="spark" className="inline size-4" /> Assistant{brand ? ` (${brand} voice)` : ""}
                  </span>
                  {(["shorten", "expand", "rephrase", "punchier", "hashtags", "thread"] as const).map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="min-h-8 rounded-full border border-line px-3 text-sm font-bold hover:border-ink disabled:opacity-50"
                      disabled={!text.trim() || assisting !== null}
                      onClick={() => void runAssist(name)}
                    >
                      {assisting === name ? "…" : ASSIST_ACTIONS[name]}
                    </button>
                  ))}
                </div>
              )}
              {assistError && <p className="mt-2 text-sm text-hot">{assistError}</p>}
              {hashtags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {hashtags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="rounded-full bg-sunk px-2 py-0.5 text-sm font-bold"
                      onClick={() => insert(tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
              <details className="mt-2 text-sm text-muted">
                <summary className="cursor-pointer">Variables and spintax</summary>
                <p className="mt-1">
                  {Object.entries(VARIABLES)
                    .map(([name, meaning]) => `{${name}} is ${meaning}`)
                    .join("; ")}
                  . Write {"{Hi|Hello|Hey}"} and each account gets one of them, so no two copies are the same.
                </p>
              </details>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  className="input"
                  type="url"
                  placeholder="Link (optional) · https://…"
                  aria-label="Link"
                  value={link}
                  onChange={(event) => setLink(event.target.value)}
                />
                <label
                  className="flex items-center gap-2 text-sm font-bold"
                  title="Each network gets its own short link with UTM tags, and the post page counts the clicks."
                >
                  <input
                    type="checkbox"
                    checked={trackLinks}
                    onChange={(event) => setTrackLinks(event.target.checked)}
                  />
                  Track clicks
                </label>
              </div>
              {providers.size > 1 && (
                <div className="mt-4">
                  <p className="text-sm font-bold">Say it differently on one network</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {SOCIAL_ORDER.filter((provider) => providers.has(provider)).map((provider) => (
                      <button
                        key={provider}
                        type="button"
                        aria-pressed={editingNetwork === provider}
                        onClick={() => setEditingNetwork(editingNetwork === provider ? null : provider)}
                        className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-bold ${editingNetwork === provider ? "border-ink bg-raised" : "border-line"}`}
                      >
                        <NetworkBadge provider={provider} size="sm" />
                        {NETWORKS[provider].label}
                        {overrides[provider]?.trim() && <span className="text-slop-text">· own words</span>}
                      </button>
                    ))}
                  </div>
                  {editingNetwork && (
                    <div className="mt-3">
                      <textarea
                        className="input min-h-28"
                        aria-label={`Words for ${NETWORKS[editingNetwork].label}`}
                        placeholder={`Leave empty to use the post above on ${NETWORKS[editingNetwork].label}.`}
                        value={overrides[editingNetwork] ?? ""}
                        maxLength={limits[editingNetwork] ?? NETWORKS[editingNetwork].textLimit}
                        onChange={(event) => setOverrides({ ...overrides, [editingNetwork]: event.target.value })}
                      />
                      {canAssist && (
                        <button
                          type="button"
                          className="mt-1 text-sm font-bold underline"
                          disabled={assisting !== null}
                          onClick={() => void runAssist("adapt")}
                        >
                          {assisting === "adapt" ? "Writing…" : `Write it for ${NETWORKS[editingNetwork].label}`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 3. Thread and first comment */}
            {(threadNetworks.length > 0 || commentNetworks.length > 0) && (
              <div className="panel grid gap-4">
                {threadNetworks.length > 0 && (
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-display text-[1.6rem] leading-none font-extrabold">Thread</h2>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn btn-quiet btn-sm"
                          onClick={autoSplit}
                          disabled={!text.trim()}
                        >
                          Split to fit
                        </button>
                        <button type="button" className="btn btn-ink btn-sm" onClick={() => setThread([...thread, ""])}>
                          <Icon name="plus" className="size-4" /> Add a post
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      On {threadNetworks.map((provider) => NETWORKS[provider].label).join(", ")}, these follow the post
                      as replies. Other networks get the post alone. A line with only --- splits a post.
                    </p>
                    <ol className="mt-3 grid gap-2">
                      {thread.map((part, index) => {
                        const used = measureFor(threadNetworks[0])(part);
                        return (
                          <li key={index} className="grid gap-1">
                            <div className="flex items-center justify-between text-xs text-muted">
                              <span className="font-bold">Post {index + 2}</span>
                              <span className={used > threadLimit ? "font-bold text-hot" : ""}>
                                {used}/{threadLimit}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <textarea
                                className="input min-h-20 flex-1"
                                aria-label={`Thread post ${index + 2}`}
                                value={part}
                                onChange={(event) =>
                                  setThread(thread.map((other, at) => (at === index ? event.target.value : other)))
                                }
                              />
                              <button
                                type="button"
                                className="btn btn-quiet btn-sm self-start"
                                aria-label={`Remove post ${index + 2}`}
                                onClick={() => setThread(thread.filter((_, at) => at !== index))}
                              >
                                <Icon name="close" className="size-4" />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
                {commentNetworks.length > 0 && (
                  <label className="grid gap-1">
                    <span className="font-bold">First comment</span>
                    <span className="text-sm text-muted">
                      Posted under it right away on{" "}
                      {commentNetworks.map((provider) => NETWORKS[provider].label).join(", ")}: hashtags, a link, a call
                      to action.
                    </span>
                    <textarea
                      className="input min-h-20"
                      value={firstComment}
                      onChange={(event) => setFirstComment(event.target.value)}
                      maxLength={2000}
                      aria-label="First comment"
                    />
                  </label>
                )}
              </div>
            )}

            {/* 4. Pictures, a video or a PDF */}
            <MediaPicker
              media={media}
              setMedia={setMedia}
              error={uploadError}
              setError={setUploadError}
              altText={[...providers].some((provider) => NETWORKS[provider].altText) || providers.size === 0}
              documents={providers.has("linkedin")}
              thumbnail={providers.has("youtube") ? cover : null}
              onThumbnail={(frame) => void makeThumbnail(frame)}
            />

            {/* 5. What only some networks ask */}
            {(providers.has("youtube") ||
              providers.has("tiktok") ||
              providers.has("instagram") ||
              (providers.has("linkedin") && shape.documents)) && (
              <div className="panel grid gap-5">
                <h2 className="font-display text-[1.6rem] leading-none font-extrabold">Network details</h2>
                {providers.has("youtube") && <YouTubeFields value={youtube} onChange={setYouTube} />}
                {providers.has("tiktok") && (
                  <TikTokFields
                    value={tiktokOptions}
                    onChange={setTikTok}
                    accounts={picked.filter((account) => account.provider === "tiktok")}
                    info={tiktok}
                  />
                )}
                {providers.has("instagram") && (
                  <fieldset className="grid gap-2">
                    <legend className="flex items-center gap-2 font-bold">
                      <NetworkBadge provider="instagram" size="sm" /> Instagram
                    </legend>
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
                {providers.has("linkedin") && shape.documents ? (
                  <label className="grid gap-1 text-sm font-bold">
                    <span className="flex items-center gap-2">
                      <NetworkBadge provider="linkedin" size="sm" /> Document title on LinkedIn
                    </span>
                    <input
                      className="input font-normal"
                      maxLength={200}
                      value={documentTitle}
                      onChange={(event) => setDocumentTitle(event.target.value)}
                    />
                  </label>
                ) : null}
              </div>
            )}

            {/* 6. Extras: tags, notes, repeating, the auto-plug */}
            <details className="panel" open={extras} onToggle={(event) => setExtras(event.currentTarget.open)}>
              <summary className="cursor-pointer font-display text-[1.6rem] leading-none font-extrabold">
                More options
              </summary>
              <div className="mt-4 grid gap-4">
                <label className="grid gap-1 text-sm font-bold">
                  Tags
                  <input
                    className="input font-normal"
                    placeholder="launch, tiltmaze"
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                  />
                  <span className="font-normal text-muted">
                    For the calendar’s filters and the analytics. The first one names the UTM campaign.
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
                  <div className="grid gap-2">
                    <label className="flex items-center gap-2 text-sm font-bold">
                      <input type="checkbox" checked={plugOn} onChange={(event) => setPlugOn(event.target.checked)} />
                      Auto-plug: reply when it takes off
                    </label>
                    {plugOn && (
                      <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
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

            {/* 7. When */}
            <div className="panel">
              <Segmented
                name="when"
                value={when}
                onChange={setWhen}
                options={[
                  { value: "now", label: "Post now" },
                  { value: "queue", label: "Add to queue" },
                  { value: "later", label: "Pick a time" },
                ]}
              />
              {when === "queue" && (
                <p className="mt-2 text-sm text-muted">
                  It takes the next free time in your queue.{" "}
                  <Link to="/studio/settings" className="underline">
                    Queue times
                  </Link>
                </p>
              )}
              {when === "later" && (
                <div className="mt-3 grid gap-2">
                  <input
                    type="datetime-local"
                    className="input w-auto justify-self-start"
                    aria-label="When it goes out"
                    value={scheduledAt}
                    onChange={(event) => setScheduledAt(event.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-bold">
                      {best[0]?.reason === "yours" ? "Your best times:" : "Good times to post:"}
                    </span>
                    {best.map((slot) => (
                      <button
                        key={`${slot.day}-${slot.minute}`}
                        type="button"
                        className="rounded-full border border-line px-2.5 py-0.5 font-bold hover:border-ink"
                        onClick={() => setScheduledAt(localInput(slot.at, timeZone))}
                      >
                        {DAYS[slot.day]} {String(Math.floor(slot.minute / 60)).padStart(2, "0")}:
                        {String(slot.minute % 60).padStart(2, "0")}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {when !== "now" && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
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
                </div>
              )}
              {(blocked.length > 0 || problems.length > 0 || actionData?.error || !canPost) && (
                <ul className="mt-4 grid gap-1 text-sm text-hot" role="status">
                  {!canPost && <li>Posting needs the content check, and it isn’t set up on this server.</li>}
                  {actionData?.error && <li>{actionData.error}</li>}
                  {blocked.map(({ account, reason }) => (
                    <li key={account.id}>
                      {account.displayName}: {reason}
                    </li>
                  ))}
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  name="submit"
                  value={when === "now" ? "now" : when === "queue" ? "queue" : "schedule"}
                  className="btn btn-slop"
                  disabled={!ready || sending}
                >
                  {sending
                    ? "Checking…"
                    : when === "later"
                      ? `Schedule for ${picked.length} account${picked.length === 1 ? "" : "s"}`
                      : when === "queue"
                        ? `Queue for ${picked.length} account${picked.length === 1 ? "" : "s"}`
                        : `Post to ${picked.length} account${picked.length === 1 ? "" : "s"}`}
                </button>
                <button
                  type="submit"
                  name="submit"
                  value="draft"
                  className="btn btn-ink"
                  disabled={!canDraft || sending}
                >
                  Save draft
                </button>
                <p className="text-sm text-muted">
                  {picked.length === 0
                    ? "Pick accounts above."
                    : `${providers.size} network${providers.size === 1 ? "" : "s"}. Checked before anything goes out.`}
                </p>
              </div>
            </div>
          </div>

          {/* Live previews */}
          <aside className="grid gap-4 lg:sticky lg:top-20" aria-label="Previews">
            <h2 className="font-display text-[1.6rem] leading-none font-extrabold">Preview</h2>
            {previews.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">
                Pick accounts to see how the post looks on each network.
              </p>
            ) : (
              previews.map(({ account, fitted, over }) => (
                <PostPreview
                  key={account.provider}
                  account={account}
                  text={fitted}
                  title={account.provider === "youtube" ? youtube.title || "Untitled video" : undefined}
                  media={readyMedia}
                  over={over}
                />
              ))
            )}
            {thread.length > 0 && threadNetworks.length > 0 && (
              <p className="text-sm text-muted">
                + {thread.length} more post{thread.length === 1 ? "" : "s"} in the thread
              </p>
            )}
          </aside>
        </Form>
      )}

      <div className="mt-16 flex flex-wrap items-center justify-between gap-3">
        <h2 className="title-2">Posts</h2>
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
        <p className="mt-4 text-muted">Nothing here yet.</p>
      ) : (
        <ul className="mt-5 grid gap-3">
          {listed.map((post) => {
            const totals = sumMetrics(post.deliveries.map((row) => row.metrics));
            const scheduled = post.scheduledAt !== null && !post.released && !post.cancelled;
            return (
              <li key={post.id}>
                <Link
                  to={`/studio/posts/${post.id}`}
                  className="panel flex flex-wrap items-center gap-4 p-4 hover:bg-raised"
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
                      {post.draft && <span className="mr-2 rounded-full bg-sunk px-2 py-0.5 text-xs">Draft</span>}
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
                        <span key={tag} className="rounded-full bg-sunk px-2 text-xs font-bold text-muted">
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

export type { TikTokOptions };
