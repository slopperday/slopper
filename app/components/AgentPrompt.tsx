import { useState } from "react";
import { Link, useRouteLoaderData } from "react-router";

/**
 * "Pass it to your agent": a ready-to-paste prompt for Claude Code, Cursor,
 * Codex or any agent, so nobody has to fill the form by hand.
 */
export function AgentPrompt({ prompt }: { prompt: (origin: string) => string }) {
  const root = useRouteLoaderData<{ origin: string }>("root");
  const text = prompt(root?.origin ?? "https://slopper.day");
  const [copied, setCopied] = useState(false);
  return (
    <details className="group rounded-2xl bg-sunk">
      <summary className="flex min-h-11 list-none items-center justify-between gap-4 px-5 py-4">
        <span>
          <span className="block font-bold">🤖 Pass it to your agent</span>
          <span className="block text-[0.9375rem] text-muted">A prompt for Claude Code, Codex or Cursor.</span>
        </span>
        <span className="shrink-0 rounded-lg bg-raised px-3 py-1.5 text-sm font-bold group-open:hidden">Show</span>
        <span className="hidden shrink-0 rounded-lg bg-raised px-3 py-1.5 text-sm font-bold group-open:inline">
          Hide
        </span>
      </summary>
      <div className="px-5 pb-5">
        <pre className="max-h-72 overflow-auto rounded-xl bg-raised p-4 font-mono text-[0.8125rem] leading-relaxed whitespace-pre-wrap">
          {text}
        </pre>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <button
            type="button"
            className="btn btn-ink btn-sm"
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            <span aria-live="polite">{copied ? "Copied ✓" : "Copy prompt"}</span>
          </button>
          <Link to="/settings/api" className="link inline-flex min-h-11 items-center text-[0.9375rem]">
            Get a token
          </Link>
        </div>
      </div>
    </details>
  );
}
