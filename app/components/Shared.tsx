import { useState } from "react";
import { NavLink } from "react-router";
import type { shareIntents } from "~/lib/compose";

/** Small shared widgets. */

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

/** One-tap sharing for everyone, no API keys involved. */
export function ShareBox({ intents, url }: { intents: ReturnType<typeof shareIntents>; url: string }) {
  const targets = [
    { href: intents.x, label: "X" },
    { href: intents.linkedin, label: "LinkedIn" },
    { href: intents.bluesky, label: "Bluesky" },
    { href: intents.threads, label: "Threads" },
  ];
  return (
    <section className="rounded-2xl border-2 border-ink bg-card p-5">
      <h2 className="eyebrow">Share it</h2>
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
    { to: "/settings/autopost", label: "Auto-post" },
    { to: "/settings/api", label: "API & MCP" },
  ];
  return (
    <nav className="flex gap-2" aria-label="Settings">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          className={({ isActive }) =>
            `rounded-full border-2 border-ink px-4 py-1.5 font-mono text-xs tracking-wider uppercase ${
              isActive ? "bg-ink text-wall" : "bg-card hover:bg-wall-deep"
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
  return <div className="rounded-2xl border-2 border-dashed border-ink/40 p-10 text-center text-muted">{children}</div>;
}
