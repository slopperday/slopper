import { useRef } from "react";
import { measureFor } from "~/lib/compose";
import { LIMITS } from "~/lib/model";
import {
  NETWORKS,
  type SocialProvider,
  TIKTOK_PRIVACY,
  TIKTOK_PRIVACY_LABELS,
  type TikTokOptions,
  type YouTubeOptions,
} from "~/lib/networks";
import type { CreatorInfo } from "~/.server/social/tiktok";
import { Icon } from "./Icon";
import { NetworkBadge, type StudioAccount } from "./Studio";

/**
 * The studio composer's parts that don't need the route: network fields,
 * counters, uploads (pictures, videos straight to storage, PDFs), alt text
 * and video covers.
 */

export interface Attachment {
  key: string;
  kind: "image" | "video" | "document";
  /** Set once the upload is registered. */
  id: string | null;
  url: string;
  progress: number;
  error: string | null;
  duration?: number;
  width?: number;
  height?: number;
  frames?: string[];
  alt?: string;
  /** The second the cover is taken from. */
  coverAt?: number;
  fileName?: string;
}

export const SOCIAL_ORDER: readonly SocialProvider[] = [
  "x",
  "linkedin",
  "bluesky",
  "threads",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
  "mastodon",
  "discord",
  "telegram",
  "reddit",
];

export function Counters({
  providers,
  text,
  link,
  overrides,
  limits,
}: {
  providers: ReadonlySet<SocialProvider>;
  text: string;
  link: string;
  overrides: Record<string, string | undefined>;
  limits: Partial<Record<SocialProvider, number>>;
}) {
  if (providers.size === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2 text-xs" aria-label="Length on each network">
      {SOCIAL_ORDER.filter((provider) => providers.has(provider)).map((provider) => {
        const measure = measureFor(provider);
        const words = (overrides[provider]?.trim() || text).trim();
        const used = measure(words) + (link.trim() ? measure(`\n\n${link.trim()}`) : 0);
        const limit = limits[provider] ?? NETWORKS[provider].textLimit;
        const over = used > limit;
        return (
          <li
            key={provider}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-bold tabular-nums ${over ? "bg-hot/15 text-hot" : "bg-sunk text-muted"}`}
            title={over ? `Longer than ${NETWORKS[provider].label} takes: it'll be cut to fit.` : undefined}
          >
            <NetworkBadge provider={provider} size="sm" />
            {used.toLocaleString()}/{limit.toLocaleString()}
          </li>
        );
      })}
    </ul>
  );
}

export function Segmented<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="mt-2 inline-flex rounded-xl bg-sunk p-1" role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <label key={option.value} className="cursor-pointer">
          <input
            type="radio"
            name={`ui-${name}`}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="peer sr-only"
          />
          <span className="flex min-h-9 items-center rounded-lg px-3 text-[0.9375rem] font-bold text-muted peer-checked:bg-ink peer-checked:text-ground peer-focus-visible:outline-2 peer-focus-visible:outline-(--focus)">
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}

export function YouTubeFields({
  value,
  onChange,
}: {
  value: YouTubeOptions;
  onChange: (value: YouTubeOptions) => void;
}) {
  return (
    <fieldset className="grid gap-3">
      <legend className="flex items-center gap-2 font-bold">
        <NetworkBadge provider="youtube" size="sm" /> YouTube
      </legend>
      <label className="grid gap-1 text-sm font-bold">
        Title
        <input
          className="input"
          maxLength={100}
          value={value.title}
          placeholder="What people see first"
          onChange={(event) => onChange({ ...value, title: event.target.value })}
        />
      </label>
      <p className="-mt-1 text-xs text-muted">
        The post above becomes the description. Vertical videos up to 3 minutes go up as Shorts.
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Segmented
          name="youtube-privacy"
          value={value.privacy}
          onChange={(privacy) => onChange({ ...value, privacy })}
          options={[
            { value: "public", label: "Public" },
            { value: "unlisted", label: "Unlisted" },
            { value: "private", label: "Private" },
          ]}
        />
        <Segmented
          name="youtube-kids"
          value={value.madeForKids ? "yes" : "no"}
          onChange={(answer) => onChange({ ...value, madeForKids: answer === "yes" })}
          options={[
            { value: "no", label: "Not made for kids" },
            { value: "yes", label: "Made for kids" },
          ]}
        />
      </div>
    </fieldset>
  );
}

/** TikTok's required posting choices, shown as its rules ask: whose account, who sees it, no defaults. */
export function TikTokFields({
  value,
  onChange,
  accounts,
  info,
}: {
  value: TikTokOptions;
  onChange: (value: TikTokOptions) => void;
  accounts: readonly StudioAccount[];
  info: Record<string, CreatorInfo | null>;
}) {
  const creators = accounts.map((account) => info[account.id]).filter((item): item is CreatorInfo => item !== null);
  // Only audiences every picked TikTok account allows.
  const allowed = TIKTOK_PRIVACY.filter((option) =>
    creators.length === 0 ? true : creators.every((creator) => creator.privacyOptions.includes(option)),
  );
  const check = (key: keyof TikTokOptions, label: string, disabled = false) => (
    <label className={`flex min-h-9 items-center gap-2 text-sm ${disabled ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        checked={Boolean(value[key]) && !disabled}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, [key]: event.target.checked })}
      />
      {label}
    </label>
  );
  return (
    <fieldset className="grid gap-2">
      <legend className="flex items-center gap-2 font-bold">
        <NetworkBadge provider="tiktok" size="sm" /> TikTok
      </legend>
      <p className="text-sm text-muted">
        Posting to{" "}
        {accounts.map((account, index) => (
          <span key={account.id}>
            {index > 0 && ", "}
            <strong className="text-ink">{info[account.id]?.nickname ?? account.displayName}</strong>
          </span>
        ))}
      </p>
      <label className="grid gap-1 text-sm font-bold">
        Who can see it
        <select
          className="input"
          value={value.privacy ?? ""}
          onChange={(event) =>
            onChange({ ...value, privacy: (event.target.value || null) as TikTokOptions["privacy"] })
          }
        >
          <option value="" disabled>
            Choose…
          </option>
          {allowed.map((option) => (
            <option key={option} value={option}>
              {TIKTOK_PRIVACY_LABELS[option]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-x-5">
        {check(
          "allowComments",
          "Allow comments",
          creators.some((creator) => creator.commentDisabled),
        )}
        {check(
          "allowDuet",
          "Allow Duet",
          creators.some((creator) => creator.duetDisabled),
        )}
        {check(
          "allowStitch",
          "Allow Stitch",
          creators.some((creator) => creator.stitchDisabled),
        )}
      </div>
      <div className="flex flex-wrap gap-x-5">
        {check("yourBrand", "Promotes my own business")}
        {check("brandedContent", "Paid partnership (branded content)")}
      </div>
      {(value.yourBrand || value.brandedContent) && (
        <p className="text-sm text-muted">
          TikTok labels it “{value.brandedContent ? "Paid partnership" : "Promotional content"}”.
        </p>
      )}
      <p className="text-xs text-muted">
        By posting, you agree to TikTok’s{" "}
        <a
          className="underline"
          href={
            value.brandedContent
              ? "https://www.tiktok.com/legal/page/global/bc-policy/en"
              : "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
          }
          target="_blank"
          rel="noopener"
        >
          {value.brandedContent ? "Branded Content Policy" : "Music Usage Confirmation"}
        </a>
        . It can take a few minutes to appear on the profile.
      </p>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Uploads

/** Pictures go up as JPEG (Instagram takes nothing else), up to 2160 px and the upload limit. */
export async function prepareImage(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2160 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.9, 0.82, 0.72]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= LIMITS.mediaBytes) return blob;
  }
  throw new Error("That picture is too big even compressed.");
}

export async function uploadPicture(blob: Blob, name: string): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.set("file", blob, name.replace(/\.\w+$/, ".jpg"));
  const response = await fetch("/api/media", { method: "POST", body: form });
  const body = (await response.json()) as { id?: string; url?: string; error?: string };
  if (!response.ok || !body.id || !body.url) throw new Error(body.error ?? "That upload didn't save.");
  return { id: body.id, url: body.url };
}

/** A video's length and size, and three frames for the content check. */
export async function readVideo(
  file: File,
): Promise<{ duration: number; width: number; height: number; frames: Blob[] }> {
  const url = URL.createObjectURL(file);
  const element = document.createElement("video");
  element.muted = true;
  element.preload = "auto";
  element.src = url;
  await new Promise((resolve, reject) => {
    element.onloadedmetadata = resolve;
    element.onerror = () => reject(new Error("That video won't open in this browser."));
  });
  const frames: Blob[] = [];
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 960 / Math.max(element.videoWidth, element.videoHeight));
  canvas.width = Math.round(element.videoWidth * scale);
  canvas.height = Math.round(element.videoHeight * scale);
  const context = canvas.getContext("2d");
  for (const at of [0.1, 0.5, 0.9]) {
    element.currentTime = element.duration * at;
    await new Promise((resolve) => (element.onseeked = resolve));
    context?.drawImage(element, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (blob) frames.push(blob);
  }
  URL.revokeObjectURL(url);
  return { duration: element.duration, width: element.videoWidth, height: element.videoHeight, frames };
}

/** Sends a video straight to storage with a progress bar, then registers it. */
export async function uploadVideo(
  file: File,
  onProgress: (share: number) => void,
): Promise<{ id: string; url: string }> {
  const contentType = file.type || "video/mp4";
  const start = await fetch("/api/studio/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ step: "start", contentType, size: file.size }),
  });
  const plan = (await start.json()) as {
    ok: boolean;
    error?: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    ticket: string;
  };
  if (!plan.ok) throw new Error(plan.error ?? "Couldn't start the upload.");
  const answer = await new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(plan.method, plan.url);
    for (const [name, value] of Object.entries(plan.headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    request.onload = () =>
      request.status < 300 ? resolve(request.responseText) : reject(new Error("The upload didn't go through."));
    request.onerror = () => reject(new Error("The upload didn't go through."));
    request.send(file);
  });
  let storageId: string | null = null;
  try {
    storageId = (JSON.parse(answer) as { storageId?: string }).storageId ?? null;
  } catch {
    // B2 answers with no body.
  }
  const finish = await fetch("/api/studio/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ step: "finish", ticket: plan.ticket, storageId }),
  });
  const done = (await finish.json()) as { ok: boolean; id?: string; url?: string; error?: string };
  if (!done.ok || !done.id) throw new Error(done.error ?? "That upload didn't save.");
  return { id: done.id, url: done.url ?? URL.createObjectURL(file) };
}

/** One frame of a video file at `seconds`, as a JPEG: a cover, or a YouTube thumbnail. */
export async function captureFrame(url: string, seconds: number): Promise<Blob> {
  const element = document.createElement("video");
  element.muted = true;
  element.preload = "auto";
  element.src = url;
  await new Promise((resolve, reject) => {
    element.onloadedmetadata = resolve;
    element.onerror = () => reject(new Error("That video won't open in this browser."));
  });
  element.currentTime = Math.min(Math.max(seconds, 0), Math.max(element.duration - 0.1, 0));
  await new Promise((resolve) => (element.onseeked = resolve));
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 1280 / Math.max(element.videoWidth, element.videoHeight));
  canvas.width = Math.round(element.videoWidth * scale);
  canvas.height = Math.round(element.videoHeight * scale);
  canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("Couldn't take that frame.");
  return blob;
}

/** A PDF for a LinkedIn document post, checked as it's uploaded (like publications). */
export async function uploadDocument(file: File): Promise<{ id: string; url: string }> {
  const form = new FormData();
  form.set("file", file, file.name);
  form.set("kind", "publication");
  const response = await fetch("/api/media", { method: "POST", body: form });
  const body = (await response.json()) as { id?: string; url?: string; error?: string; format?: string };
  if (!response.ok || !body.id || !body.url) throw new Error(body.error ?? "That upload didn't save.");
  if (body.format && body.format !== "pdf") throw new Error("LinkedIn documents are PDFs.");
  return { id: body.id, url: body.url };
}

export function MediaPicker({
  media,
  setMedia,
  error,
  setError,
  altText,
  documents,
  thumbnail,
  onThumbnail,
}: {
  media: Attachment[];
  setMedia: React.Dispatch<React.SetStateAction<Attachment[]>>;
  error: string | null;
  setError: (error: string | null) => void;
  /** Some picked network shows alt text. */
  altText: boolean;
  /** LinkedIn is picked, so a PDF can go. */
  documents: boolean;
  /** YouTube is picked: a custom thumbnail can be made from the cover frame. */
  thumbnail: { id: string | null; busy: boolean } | null;
  onThumbnail: (frame: Blob) => void;
}) {
  const pictures = useRef<HTMLInputElement>(null);
  const videos = useRef<HTMLInputElement>(null);
  const pdfs = useRef<HTMLInputElement>(null);
  const hasVideo = media.some((item) => item.kind === "video");
  const patch = (key: string, next: Partial<Attachment>) =>
    setMedia((list) => list.map((item) => (item.key === key ? { ...item, ...next } : item)));

  async function addPictures(files: FileList | null) {
    setError(null);
    for (const file of Array.from(files ?? []).slice(0, 10 - media.length)) {
      const key = crypto.randomUUID();
      setMedia((list) => [
        ...list,
        { key, kind: "image", id: null, url: URL.createObjectURL(file), progress: 0, error: null, alt: "" },
      ]);
      try {
        const uploaded = await uploadPicture(await prepareImage(file), file.name);
        // The preview keeps showing the file from this device: it's there already, and it's what was sent.
        patch(key, { id: uploaded.id, progress: 1 });
      } catch (problem) {
        patch(key, { error: problem instanceof Error ? problem.message : "That upload didn't save." });
      }
    }
  }

  async function addVideo(file: File | undefined) {
    if (!file) return;
    setError(null);
    const key = crypto.randomUUID();
    setMedia((list) => [
      ...list,
      { key, kind: "video", id: null, url: URL.createObjectURL(file), progress: 0, error: null },
    ]);
    try {
      const facts = await readVideo(file);
      const frames: string[] = [];
      for (const [index, frame] of facts.frames.entries()) {
        frames.push((await uploadPicture(frame, `frame-${index}.jpg`)).id);
      }
      patch(key, { duration: facts.duration, width: facts.width, height: facts.height, frames, coverAt: 0 });
      const uploaded = await uploadVideo(file, (progress) => patch(key, { progress }));
      patch(key, { id: uploaded.id, progress: 1 });
    } catch (problem) {
      patch(key, { error: problem instanceof Error ? problem.message : "That upload didn't save." });
    }
  }

  async function addDocument(file: File | undefined) {
    if (!file) return;
    setError(null);
    const key = crypto.randomUUID();
    setMedia((list) => [
      ...list,
      { key, kind: "document", id: null, url: "", progress: 0, error: null, fileName: file.name },
    ]);
    try {
      const uploaded = await uploadDocument(file);
      patch(key, { id: uploaded.id, url: uploaded.url, progress: 1 });
    } catch (problem) {
      patch(key, { error: problem instanceof Error ? problem.message : "That upload didn't save." });
    }
  }

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[1.6rem] leading-none font-extrabold">Pictures, video or a PDF</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ink btn-sm"
            disabled={hasVideo || media.length >= 10 || media.some((item) => item.kind === "document")}
            onClick={() => pictures.current?.click()}
          >
            <Icon name="plus" className="size-4" /> Pictures
          </button>
          <button
            type="button"
            className="btn btn-ink btn-sm"
            disabled={media.length > 0}
            onClick={() => videos.current?.click()}
          >
            <Icon name="play" className="size-4" /> Video
          </button>
          {documents && (
            <button
              type="button"
              className="btn btn-ink btn-sm"
              disabled={media.length > 0}
              onClick={() => pdfs.current?.click()}
            >
              <Icon name="page" className="size-4" /> PDF
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">
        Instagram needs one or the other; TikTok and YouTube need a video; a PDF goes to LinkedIn as a swipeable
        document. Videos up to {LIMITS.socialVideoBytes / 1024 / 1024} MB.
      </p>
      <input
        ref={pictures}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        onChange={(event) => void addPictures(event.target.files)}
      />
      <input
        ref={videos}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        hidden
        onChange={(event) => void addVideo(event.target.files?.[0])}
      />
      <input
        ref={pdfs}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(event) => void addDocument(event.target.files?.[0])}
      />
      {media.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {media.map((item) => (
            <li key={item.key} className="relative flex gap-3 rounded-xl bg-raised p-2">
              <div className="relative size-24 shrink-0 overflow-hidden rounded-lg bg-sunk">
                {item.kind === "video" ? (
                  <video src={item.url} className="size-full object-cover" muted playsInline preload="metadata" />
                ) : item.kind === "document" ? (
                  <span className="grid size-full place-items-center p-1 text-center text-xs font-bold">
                    <Icon name="page" className="size-6" />
                    PDF
                  </span>
                ) : (
                  <img src={item.url} alt={item.alt ?? ""} className="size-full object-cover" />
                )}
                <button
                  type="button"
                  className="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-ink/75 text-ground"
                  aria-label="Remove"
                  onClick={() => setMedia((list) => list.filter((other) => other.key !== item.key))}
                >
                  <Icon name="close" className="size-3.5" />
                </button>
              </div>
              <div className="min-w-0 flex-1 text-sm">
                {item.id === null && !item.error && (
                  <div className="h-1.5 overflow-hidden rounded-full bg-sunk" aria-label="Uploading">
                    <div className="h-full bg-slop" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                  </div>
                )}
                {item.error && <p className="text-xs text-hot">{item.error}</p>}
                {item.kind === "document" && <p className="truncate font-bold">{item.fileName}</p>}
                {item.kind === "image" && altText && (
                  <label className="grid gap-1 text-xs font-bold">
                    Alt text
                    <textarea
                      className="input min-h-14 text-sm font-normal"
                      maxLength={1000}
                      placeholder="What's in the picture, for people who can't see it"
                      value={item.alt ?? ""}
                      onChange={(event) => patch(item.key, { alt: event.target.value })}
                    />
                  </label>
                )}
                {item.kind === "video" && item.duration !== undefined && (
                  <div className="grid gap-1">
                    <p className="text-xs text-muted">
                      {Math.floor(item.duration / 60)}:{String(Math.round(item.duration % 60)).padStart(2, "0")} ·{" "}
                      {item.width && item.height && item.height > item.width ? "vertical" : "landscape"}
                    </p>
                    <label className="grid gap-1 text-xs font-bold">
                      Cover at {Math.round(item.coverAt ?? 0)}s
                      <input
                        type="range"
                        min={0}
                        max={Math.max(Math.floor(item.duration), 0)}
                        value={item.coverAt ?? 0}
                        onChange={(event) => patch(item.key, { coverAt: Number(event.target.value) })}
                      />
                    </label>
                    {thumbnail && (
                      <button
                        type="button"
                        className="justify-self-start text-xs font-bold underline"
                        disabled={thumbnail.busy}
                        onClick={async () => {
                          try {
                            onThumbnail(await captureFrame(item.url, item.coverAt ?? 0));
                          } catch (problem) {
                            setError(problem instanceof Error ? problem.message : "Couldn't take that frame.");
                          }
                        }}
                      >
                        {thumbnail.busy
                          ? "Saving thumbnail…"
                          : thumbnail.id
                            ? "YouTube thumbnail set · use this frame instead"
                            : "Use this frame as the YouTube thumbnail"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-hot">{error}</p>}
    </div>
  );
}

export type { StudioAccount };
