import { Form } from "react-router";
import { Icon } from "./Icon";
import { type CrosspostMode, type CrosspostResult, NETWORK_LABELS, type SocialProvider } from "~/lib/model";

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
    <fieldset className="inline-flex rounded-xl bg-sunk p-1">
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
          <span className="flex min-h-9 items-center rounded-lg px-3 text-[0.9375rem] font-bold text-muted peer-checked:bg-ink peer-checked:text-ground peer-focus-visible:outline-2 peer-focus-visible:outline-(--focus)">
            {mode.label}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Owner-only receipt of where an update was posted, with a retry. */
export function CrosspostReceipts({ update }: { update: { id: string; crossposts: readonly CrosspostResult[] } }) {
  const failed = update.crossposts.some((result) => result.status === "error");
  return (
    <div className="mt-3 rounded-xl bg-sunk p-3 text-sm">
      <ul className="grid gap-1">
        {update.crossposts.map((result) => (
          <li key={result.accountId} className="flex flex-wrap items-center gap-2">
            <span
              className={
                result.status === "ok"
                  ? "font-bold text-slop-text"
                  : result.status === "error"
                    ? "font-bold text-hot"
                    : "text-muted"
              }
            >
              <Icon name={result.status === "ok" ? "check" : "close"} className="size-4" />
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
          <button type="submit" className="min-h-9 font-bold underline">
            Retry failed
          </button>
        </Form>
      )}
    </div>
  );
}
