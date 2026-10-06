import { Form } from "react-router";
import { type CrosspostMode, NETWORK_LABELS, type SlopUpdate, type SocialProvider } from "~/lib/model";

const MODES: { value: CrosspostMode; label: string }[] = [
  { value: "post", label: "Post" },
  { value: "amplify", label: "Repost" },
  { value: "off", label: "Off" },
];

/** Segmented radio control for how an account auto-posts. */
export function ModePicker({
  name,
  provider,
  value,
}: {
  name: string;
  provider: SocialProvider;
  value: CrosspostMode;
}) {
  // LinkedIn has no API for resharing someone else's post.
  const modes = provider === "linkedin" ? MODES.filter((mode) => mode.value !== "amplify") : MODES;
  return (
    <fieldset className="inline-flex rounded-full border-2 border-ink bg-wall p-0.5">
      <legend className="sr-only">Auto-post mode</legend>
      {modes.map((mode) => (
        <label key={mode.value} className="cursor-pointer">
          <input
            type="radio"
            name={name}
            value={mode.value}
            defaultChecked={value === mode.value}
            className="peer sr-only"
          />
          <span className="block rounded-full px-3 py-1 font-mono text-[0.68rem] tracking-wider uppercase peer-checked:bg-ink peer-checked:text-wall peer-focus-visible:outline-2 peer-focus-visible:outline-slop">
            {mode.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Owner-only receipt of where an update was posted, with a retry. */
export function CrosspostReceipts({ update }: { update: Pick<SlopUpdate, "id" | "crossposts"> }) {
  const failed = update.crossposts.some((result) => result.status === "error");
  return (
    <div className="mt-3 rounded-lg border border-dashed border-ink/40 p-3 font-mono text-[0.68rem]">
      <ul className="grid gap-1">
        {update.crossposts.map((result) => (
          <li key={result.accountId} className="flex flex-wrap items-center gap-2">
            <span
              className={
                result.status === "ok" ? "text-slop-deep" : result.status === "error" ? "text-hot" : "text-muted"
              }
            >
              {result.status === "ok" ? "✓" : result.status === "error" ? "✕" : "–"}
            </span>
            <span>
              {result.mode === "post" ? "Posted" : "Reposted"} on {NETWORK_LABELS[result.provider]} as {result.handle}
            </span>
            {result.url && (
              <a href={result.url} target="_blank" rel="noopener" className="underline">
                view
              </a>
            )}
            {result.message && <span className="basis-full pl-5 text-muted">{result.message}</span>}
          </li>
        ))}
      </ul>
      {failed && (
        <Form method="post" className="mt-2">
          <input type="hidden" name="intent" value="retry-autopost" />
          <input type="hidden" name="id" value={update.id} />
          <button type="submit" className="underline">
            Retry failed
          </button>
        </Form>
      )}
    </div>
  );
}
