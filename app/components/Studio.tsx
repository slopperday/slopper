import { useState } from "react";
import { NavLink } from "react-router";
import { NETWORKS, type SocialProvider, STAT_LABELS, type StatName } from "~/lib/networks";
import { Icon } from "./Icon";

/** Each network's mark, drawn in `currentColor`. Instagram and Threads are drawn from shapes. */
const MARKS: Partial<Record<SocialProvider, string>> = {
  x: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  linkedin:
    "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  bluesky:
    "M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z",
  facebook:
    "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
  tiktok:
    "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  youtube:
    "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  mastodon:
    "M23.268 5.313c-.35-2.578-2.617-4.61-5.304-5.004C17.51.242 15.792 0 11.813 0h-.03c-3.98 0-4.835.242-5.288.309C3.882.692 1.496 2.518.917 5.127.64 6.412.61 7.837.661 9.143c.074 1.874.088 3.745.26 5.611.118 1.24.325 2.47.62 3.68.55 2.237 2.777 4.098 4.96 4.857 2.336.792 4.849.923 7.256.38.265-.061.527-.132.786-.213.585-.184 1.27-.39 1.774-.753a.057.057 0 0 0 .023-.043v-1.809a.052.052 0 0 0-.02-.041.053.053 0 0 0-.046-.01 20.282 20.282 0 0 1-4.709.545c-2.73 0-3.463-1.284-3.674-1.818a5.593 5.593 0 0 1-.319-1.433.053.053 0 0 1 .066-.054c1.517.363 3.072.546 4.632.546.376 0 .75 0 1.125-.01 1.57-.044 3.224-.124 4.768-.422.038-.008.077-.015.11-.024 2.435-.464 4.753-1.92 4.989-5.604.008-.145.03-1.52.03-1.67.002-.512.167-3.63-.024-5.545zm-3.748 9.195h-2.561V8.29c0-1.309-.55-1.976-1.67-1.976-1.23 0-1.846.79-1.846 2.35v3.403h-2.546V8.663c0-1.56-.617-2.35-1.848-2.35-1.112 0-1.668.668-1.67 1.977v6.218H4.822V8.102c0-1.31.337-2.35 1.011-3.12.696-.77 1.608-1.164 2.74-1.164 1.311 0 2.302.5 2.962 1.498l.638 1.06.638-1.06c.66-.999 1.65-1.498 2.96-1.498 1.13 0 2.043.395 2.74 1.164.675.77 1.012 1.81 1.012 3.12v6.406z",
  discord:
    "M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z",
  telegram:
    "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  reddit:
    "M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z",
};

/** Brand colours, for the badge behind each mark. */
export const NETWORK_COLORS: Record<SocialProvider, string> = {
  x: "#0f1419",
  linkedin: "#0a66c2",
  bluesky: "#1185fe",
  threads: "#101010",
  facebook: "#0866ff",
  instagram: "#d62976",
  tiktok: "#111111",
  youtube: "#ff0000",
  mastodon: "#6364ff",
  discord: "#5865f2",
  telegram: "#26a5e4",
  reddit: "#ff4500",
};

export function NetworkMark({ provider, className = "size-4" }: { provider: SocialProvider; className?: string }) {
  const path = MARKS[provider];
  if (path) {
    return (
      <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden="true">
        <path fill="currentColor" d={path} />
      </svg>
    );
  }
  if (provider === "instagram") {
    return (
      <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden="true">
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <circle cx="17.6" cy="6.4" r="1.4" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden="true">
      <text x="12" y="18" textAnchor="middle" fontSize="19" fontWeight="700" fill="currentColor">
        @
      </text>
    </svg>
  );
}

/** A network's mark on its colour, as a small round badge. */
export function NetworkBadge({ provider, size = "md" }: { provider: SocialProvider; size?: "sm" | "md" }) {
  const box = size === "sm" ? "size-5" : "size-7";
  const mark = size === "sm" ? "size-3" : "size-4";
  return (
    <span
      className={`inline-grid ${box} shrink-0 place-items-center rounded-full text-white`}
      style={{ background: NETWORK_COLORS[provider] }}
      title={NETWORKS[provider].label}
    >
      <NetworkMark provider={provider} className={mark} />
    </span>
  );
}

export interface StudioAccount {
  id: string;
  provider: SocialProvider;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  brand: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
}

/** An account's picture with its network's badge on the corner. */
export function AccountAvatar({ account, size = 40 }: { account: StudioAccount; size?: number }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {account.avatarUrl ? (
        <img
          src={account.avatarUrl}
          alt=""
          className="size-full rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="grid size-full place-items-center rounded-full bg-raised font-display text-lg font-extrabold">
          {(account.displayName || account.handle).slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="absolute -right-1 -bottom-1 rounded-full ring-2 ring-ground">
        <NetworkBadge provider={account.provider} size="sm" />
      </span>
    </span>
  );
}

export function StudioNav() {
  const tabs = [
    { to: "/studio", label: "Compose" },
    { to: "/studio/calendar", label: "Calendar" },
    { to: "/studio/analytics", label: "Analytics" },
    { to: "/studio/settings", label: "Settings" },
    { to: "/settings/autopost", label: "Accounts" },
  ];
  return (
    <nav className="scrollbar-none flex overflow-x-auto border-b border-line" aria-label="Studio">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) =>
            `relative flex min-h-11 shrink-0 items-center px-3 font-bold whitespace-nowrap first:pl-0 after:absolute after:right-3 after:bottom-0 after:left-3 after:h-[3px] after:rounded-t-full first:after:left-0 ${
              isActive ? "text-ink after:bg-slop" : "text-muted hover:text-ink"
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

export type DeliveryStatus = "queued" | "sending" | "processing" | "ok" | "error" | "skipped" | "removed";

const STATUS: Record<DeliveryStatus, { label: string; className: string }> = {
  queued: { label: "Waiting", className: "bg-sunk text-muted" },
  sending: { label: "Sending", className: "bg-sunk text-ink" },
  processing: { label: "Processing", className: "bg-sunk text-ink" },
  ok: { label: "Posted", className: "bg-slop/15 text-slop-text" },
  error: { label: "Failed", className: "bg-hot/15 text-hot" },
  skipped: { label: "Skipped", className: "bg-sunk text-muted" },
  removed: { label: "Taken down", className: "bg-sunk text-muted" },
};

export function StatusPill({
  status,
  scheduled = false,
  draft = false,
}: {
  status: DeliveryStatus;
  scheduled?: boolean;
  draft?: boolean;
}) {
  const { label, className } =
    draft && status === "queued"
      ? { ...STATUS.queued, label: "Draft" }
      : scheduled && status === "queued"
        ? { ...STATUS.queued, label: "Scheduled" }
        : STATUS[status];
  return (
    <span className={`inline-flex min-h-6 items-center gap-1 rounded-full px-2 text-xs font-bold ${className}`}>
      {status === "ok" && <Icon name="check" className="size-3" />}
      {(status === "sending" || status === "processing") && <Icon name="sync" className="size-3 animate-spin" />}
      {label}
    </span>
  );
}

export type Metrics = Partial<Record<StatName, number>>;

export function sumMetrics(list: readonly (Metrics | null)[]): Metrics {
  const total: Metrics = {};
  for (const metrics of list) {
    if (!metrics) continue;
    for (const [name, value] of Object.entries(metrics) as [StatName, number][]) {
      total[name] = (total[name] ?? 0) + value;
    }
  }
  return total;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function formatCount(value: number | undefined): string {
  return value === undefined ? "–" : compact.format(value);
}

/** A row of stats: views, likes, comments, shares. */
export function MetricRow({ metrics, names }: { metrics: Metrics; names?: readonly StatName[] }) {
  const shown = names ?? (["views", "likes", "comments", "shares"] as const);
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {shown.map((name) => (
        <div key={name} className="flex items-baseline gap-1">
          <dt className="text-muted">{STAT_LABELS[name]}</dt>
          <dd className="font-bold tabular-nums">{formatCount(metrics[name])}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A readable approximation of each network's feed, using the real copy and selected media. */
export function PostPreview({
  account,
  text,
  title,
  media,
  over,
  instagramFormat = "feed",
  replies = [],
  firstComment = "",
}: {
  account: StudioAccount;
  text: string;
  title?: string;
  media: readonly { kind: "image" | "video"; url: string }[];
  over: boolean;
  instagramFormat?: "feed" | "story";
  replies?: readonly string[];
  firstComment?: string;
}) {
  const provider = account.provider;
  const [slide, setSlide] = useState(0);
  const position = Math.min(slide, Math.max(0, media.length - 1));
  const first = media[position];
  const vertical = provider === "tiktok" || (provider === "instagram" && instagramFormat === "story");
  const mediaFirst = provider === "instagram" || provider === "tiktok" || provider === "youtube";
  const dark = provider === "tiktok" || (provider === "instagram" && instagramFormat === "story");
  const grid =
    !vertical &&
    (provider === "x" || provider === "bluesky") &&
    media.length > 1 &&
    media.every((item) => item.kind === "image");
  const showCarousel = !grid && media.length > 1;
  const avatar = account.avatarUrl ? (
    <img
      src={account.avatarUrl}
      alt=""
      className="size-10 shrink-0 rounded-full object-cover"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-200 text-sm font-bold text-slate-800">
      {(account.displayName || account.handle).slice(0, 1).toUpperCase()}
    </span>
  );
  const picture = first && (
    <div
      className={`relative overflow-hidden bg-slate-100 ${vertical ? "aspect-[9/16]" : provider === "instagram" ? "aspect-square" : "aspect-video"} ${provider === "instagram" || vertical ? "" : "mx-3 rounded-xl"}`}
    >
      {grid ? (
        <div className="grid size-full grid-cols-2 gap-0.5">
          {media.slice(0, 4).map((item, index) => (
            <img
              key={`${item.url}-${index}`}
              src={item.url}
              alt={`Attachment ${index + 1}`}
              className="size-full min-h-0 object-cover"
            />
          ))}
        </div>
      ) : first.kind === "video" ? (
        <video
          src={first.url}
          className="size-full object-cover"
          controls
          playsInline
          preload="metadata"
          aria-label="Preview video"
        />
      ) : (
        <img src={first.url} alt={`Attachment ${position + 1}`} className="size-full object-cover" />
      )}
      {showCarousel && (
        <>
          <span className="absolute top-3 right-3 rounded-full bg-black/70 px-2.5 py-1 text-xs font-bold text-white">
            {position + 1} / {media.length}
          </span>
          <div className="absolute inset-x-2 top-1/2 flex -translate-y-1/2 justify-between">
            <button
              type="button"
              className="grid size-9 place-items-center rounded-full bg-white/90 text-slate-900 shadow disabled:invisible"
              aria-label="Previous attachment"
              disabled={position === 0}
              onClick={() => setSlide(position - 1)}
            >
              <Icon name="left" />
            </button>
            <button
              type="button"
              className="grid size-9 place-items-center rounded-full bg-white/90 text-slate-900 shadow disabled:invisible"
              aria-label="Next attachment"
              disabled={position >= media.length - 1}
              onClick={() => setSlide(position + 1)}
            >
              <Icon name="right" />
            </button>
          </div>
        </>
      )}
      {vertical && text && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pt-20 pb-4 text-sm text-white">
          <strong>@{account.handle}</strong>
          <p className="mt-1 line-clamp-4 whitespace-pre-wrap">{text}</p>
        </div>
      )}
    </div>
  );
  const header = (
    <div className="flex items-center gap-3 px-4 py-3">
      {avatar}
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-bold">{account.displayName || account.handle}</p>
        <p className={`truncate text-xs ${dark ? "text-slate-300" : "text-slate-500"}`}>
          {provider === "youtube" || provider === "facebook" ? "Just now · Public" : `@${account.handle} · now`}
        </p>
      </div>
      <span aria-hidden="true" className="text-lg leading-none">
        ···
      </span>
    </div>
  );
  const words = text && !vertical && (
    <p className="px-4 py-3 text-[0.9375rem] leading-5 break-words whitespace-pre-wrap">
      {provider === "instagram" && <strong>{account.handle} </strong>}
      {text}
    </p>
  );
  return (
    <article
      className="overflow-hidden rounded-2xl border border-line bg-ground"
      aria-label={`${NETWORKS[provider].label} preview`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-xs font-bold text-muted">
        <span className="flex items-center gap-2">
          <NetworkBadge provider={provider} size="sm" />
          {NETWORKS[provider].label} · {previewFormat(provider, media, instagramFormat)}
        </span>
        {over && <span className="text-hot">Cut to fit</span>}
      </div>
      <div className={`font-sans ${dark ? "bg-[#121212] text-white" : "bg-white text-[#0f1419]"}`}>
        {header}
        {provider === "youtube" && title && <p className="px-4 pb-2 font-bold">{title}</p>}
        {!mediaFirst && words}
        {picture}
        {mediaFirst && words}
        {provider === "youtube" && <p className="px-4 pb-2 text-xs text-slate-500">Description</p>}
        <div
          className={`flex items-center justify-between gap-3 px-4 py-3 text-xs font-medium ${dark ? "text-slate-300" : "text-slate-500"}`}
          aria-hidden="true"
        >
          <span>{provider === "youtube" ? "Like" : "♡  Like"}</span>
          <span>◯ Comment</span>
          <span>{provider === "x" || provider === "bluesky" || provider === "threads" ? "↻  Repost" : "↗  Share"}</span>
          <span>↗</span>
        </div>
        {(replies.length > 0 || firstComment) && (
          <div className={`border-t px-4 py-3 text-sm ${dark ? "border-slate-700" : "border-slate-200"}`}>
            {replies.map((reply, index) => (
              <div key={index} className="flex gap-3 py-2">
                {avatar}
                <div>
                  <strong>{account.displayName || account.handle}</strong>
                  <p className="mt-1 break-words whitespace-pre-wrap">{reply}</p>
                </div>
              </div>
            ))}
            {firstComment && (
              <div className="flex gap-3 py-2">
                {avatar}
                <div>
                  <strong>{account.displayName || account.handle}</strong>
                  <p className="mt-1 break-words whitespace-pre-wrap">{firstComment}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function previewFormat(
  provider: SocialProvider,
  media: readonly { kind: "image" | "video" }[],
  instagramFormat: "feed" | "story",
): string {
  const video = media.some((item) => item.kind === "video");
  switch (provider) {
    case "instagram":
      return instagramFormat === "story" ? "Story" : video ? "Reel" : media.length > 1 ? "Carousel" : "Feed post";
    case "youtube":
      return "Video";
    case "tiktok":
      return "Video";
    case "facebook":
      return video ? "Page video" : "Page post";
    default:
      return video ? "Post with video" : media.length ? "Post with pictures" : "Post";
  }
}
