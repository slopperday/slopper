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

/**
 * How a post will look on one network: the account, the fitted words, the
 * media as that network frames it. Close enough to judge, not a pixel copy.
 */
export function PostPreview({
  account,
  text,
  title,
  media,
  over,
}: {
  account: StudioAccount;
  text: string;
  title?: string;
  media: readonly { kind: "image" | "video"; url: string }[];
  /** The words were cut to fit. */
  over: boolean;
}) {
  const provider = account.provider;
  const tall =
    provider === "tiktok" || provider === "instagram" || (provider === "youtube" && media[0]?.kind === "video");
  const first = media[0];
  return (
    <article
      className="overflow-hidden rounded-2xl border border-line bg-ground"
      aria-label={`${NETWORKS[provider].label} preview`}
    >
      <header className="flex items-center gap-2 px-3 pt-3">
        <AccountAvatar account={account} size={32} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-bold">{account.displayName}</p>
          <p className="truncate text-xs text-muted">
            {provider === "facebook" || provider === "youtube" ? NETWORKS[provider].label : `@${account.handle}`}
          </p>
        </div>
        <NetworkBadge provider={provider} size="sm" />
      </header>
      {provider === "youtube" && title && <p className="px-3 pt-2 font-bold">{title}</p>}
      {text && provider !== "tiktok" && provider !== "instagram" && (
        <p className="px-3 pt-2 text-[0.9375rem] break-words whitespace-pre-wrap">{text}</p>
      )}
      {first && (
        <div className={`mx-3 mt-2 overflow-hidden rounded-xl bg-sunk ${tall ? "aspect-[9/12]" : "aspect-video"}`}>
          {first.kind === "video" ? (
            <video src={first.url} className="size-full object-cover" muted playsInline preload="metadata" />
          ) : (
            <img src={first.url} alt="" className="size-full object-cover" />
          )}
          {media.length > 1 && (
            <span className="relative -mt-8 ml-2 inline-block rounded-full bg-ink/70 px-2 text-xs font-bold text-ground">
              1/{media.length}
            </span>
          )}
        </div>
      )}
      {text && (provider === "tiktok" || provider === "instagram") && (
        <p className="px-3 pt-2 text-[0.9375rem] break-words whitespace-pre-wrap">
          <strong>{account.handle}</strong> {text}
        </p>
      )}
      <footer className="flex items-center justify-between px-3 py-3 text-xs text-muted">
        <span>{previewFormat(provider, media)}</span>
        {over && <span className="font-bold text-hot">Cut to fit</span>}
      </footer>
    </article>
  );
}

function previewFormat(provider: SocialProvider, media: readonly { kind: "image" | "video" }[]): string {
  const video = media.some((item) => item.kind === "video");
  switch (provider) {
    case "instagram":
      return video ? "Reel" : media.length > 1 ? "Carousel" : "Feed post";
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
