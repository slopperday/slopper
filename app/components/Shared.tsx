import { useState } from "react";
import { NavLink, useRouteLoaderData } from "react-router";
import type { loader as rootLoader } from "~/root";
import type { shareIntents } from "~/lib/compose";
import { Icon } from "./Icon";

/** Small shared widgets. */

/** The networks this server can auto-post to (see `autopostNetworks`), for copy that names them. */
export function useAutopostNetworks(): string[] {
  // Root data is only missing on error pages, where Bluesky (no keys needed) is still true.
  return useRouteLoaderData<typeof rootLoader>("root")?.autopostNetworks ?? ["Bluesky"];
}

/** Server-rendered Markdown. The HTML comes from `.server/markdown`, which escapes raw HTML. */
export function Markdown({ html, className = "" }: { html: string; className?: string }) {
  // oxlint-disable-next-line react/no-danger -- sanitised by renderMarkdown on the server
  return <div className={`prose-slop ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function CopyButton({ value, label = "Copy link" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm w-full"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <span aria-live="polite">{copied ? "Copied ✓" : label}</span>
    </button>
  );
}

/** The copy icon on its own, for values shown in a row: a check confirms the copy. */
export function CopyIconButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-quiet btn-sm px-2.5"
      aria-label={label}
      title={label}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
    >
      <Icon name={copied ? "check" : "copy"} className="size-5" />
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}

/** One-tap sharing for everyone, no API keys involved. */
export function ShareBox({ intents, url }: { intents: ReturnType<typeof shareIntents>; url: string }) {
  const targets = [
    { href: intents.x, label: "X" },
    { href: intents.linkedin, label: "LinkedIn" },
    { href: intents.bluesky, label: "Bluesky" },
    { href: intents.threads, label: "Threads" },
  ];
  return (
    <section aria-labelledby="share-title">
      <h2 id="share-title" className="caps">
        Share it
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {targets.map((target) => (
          <a key={target.label} href={target.href} target="_blank" rel="noopener" className="btn btn-sm">
            {target.label}
          </a>
        ))}
      </div>
      <div className="mt-2">
        <CopyButton value={url} />
      </div>
    </section>
  );
}

export function SettingsNav() {
  const tabs = [
    { to: "/settings", label: "Profile" },
    { to: "/settings/autopost", label: "Accounts" },
    { to: "/settings/security", label: "Security" },
    { to: "/settings/api", label: "API & MCP" },
  ];
  return (
    <nav className="scrollbar-none flex overflow-x-auto border-b border-line" aria-label="Settings">
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

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-sunk px-6 py-12 text-center text-muted">{children}</div>;
}
