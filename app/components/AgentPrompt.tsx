import { useState } from "react";
import { Link, useRouteLoaderData } from "react-router";

/**
 * "Let your AI do it": a ready-to-paste prompt for Claude Code, Cursor,
 * Codex or any agent, so nobody has to fill the form by hand.
 */
export function AgentPrompt({ prompt }: { prompt: (origin: string) => string }) {
  const root = useRouteLoaderData<{ origin: string }>("root");
  const text = prompt(root?.origin ?? "https://slopper.day");
  const [copied, setCopied] = useState(false);
  return (
    <details className="group rounded-2xl border-2 border-ink bg-ink text-wall">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block font-black">🤖 Let your AI do it</span>
          <span className="block text-sm text-wall/70">
            Copy this prompt into Claude Code, Cursor, Codex or any agent. It uses the Slopper MCP.
          </span>
        </span>
        <span className="font-mono text-xs tracking-wider uppercase group-open:hidden">Show</span>
        <span className="hidden font-mono text-xs tracking-wider uppercase group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-wall/20 px-5 pt-4 pb-5">
        <pre className="max-h-72 overflow-auto rounded-xl bg-black/30 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {text}
        </pre>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-slop btn-sm"
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          >
            <span aria-live="polite">{copied ? "Copied ✓" : "Copy prompt"}</span>
          </button>
          <Link to="/settings/api" className="text-sm text-wall/80 underline">
            Get an API token
          </Link>
        </div>
      </div>
    </details>
  );
}
