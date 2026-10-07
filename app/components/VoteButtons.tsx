import { Link, useFetcher } from "react-router";
import { Icon } from "./Icon";

type Vote = 1 | -1 | 0;

interface Props {
  slopId: string;
  upvotes: number;
  vote: Vote;
  /** "login" sends visitors to sign in; "own" disables voting on your slop. */
  mode: "vote" | "login" | "own";
  loginHref: string;
  size?: "sm" | "lg";
}

function parseVote(value: FormDataEntryValue | null): Vote {
  return value === "1" ? 1 : value === "-1" ? -1 : 0;
}

/**
 * Upvote and private downvote. Only upvotes are ever shown; a downvote
 * quietly lowers the ranking and nobody sees it.
 */
export function VoteButtons({ slopId, upvotes, vote, mode, loginHref, size = "sm" }: Props) {
  const fetcher = useFetcher<{ upvotes: number; vote: Vote }>();
  const large = size === "lg";

  // Optimistic: while a vote is in flight, show where it is going.
  let shownVote = fetcher.data?.vote ?? vote;
  let shownUpvotes = fetcher.data?.upvotes ?? upvotes;
  if (fetcher.formData) {
    const next = parseVote(fetcher.formData.get("vote"));
    shownUpvotes += (next === 1 ? 1 : 0) - (shownVote === 1 ? 1 : 0);
    shownVote = next;
  }

  const button = `inline-flex items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
    large ? "size-12" : "size-11"
  }`;
  const icon = large ? "size-6" : "size-5";
  const count = large ? "text-[1.75rem]" : "text-[1.3rem]";

  if (mode === "login") {
    return (
      <Link
        to={loginHref}
        className={`relative z-10 inline-flex items-center rounded-full bg-sunk pr-4 font-display leading-none font-extrabold tabular-nums transition-colors hover:bg-line ${count}`}
        title="Sign in to vote"
      >
        <span className={button} aria-hidden="true">
          <Icon name="up" className={icon} />
        </span>
        {shownUpvotes}
      </Link>
    );
  }

  const upActive = shownVote === 1;
  const downActive = shownVote === -1;
  return (
    <fetcher.Form
      method="post"
      action={`/api/slops/${slopId}/vote`}
      className={`relative z-10 inline-flex shrink-0 items-center rounded-full bg-sunk font-display leading-none font-extrabold tabular-nums ${count}`}
    >
      <button
        type="submit"
        name="vote"
        value={upActive ? "0" : "1"}
        className={`${button} ${upActive ? "bg-ink text-ground" : "enabled:hover:bg-line"}`}
        aria-pressed={upActive}
        aria-label="Upvote"
        title={mode === "own" ? "Your own slop" : "This sticks"}
        disabled={mode === "own"}
      >
        <Icon name="up" className={icon} />
      </button>
      <span className="min-w-7 px-0.5 text-center" aria-live="polite">
        {shownUpvotes}
      </span>
      <button
        type="submit"
        name="vote"
        value={downActive ? "0" : "-1"}
        className={`${button} ${downActive ? "bg-muted text-ground" : "text-muted enabled:hover:bg-line"}`}
        aria-pressed={downActive}
        aria-label="Downvote (private)"
        title="Not for me. Downvotes are private"
        disabled={mode === "own"}
      >
        <Icon name="down" className={icon} />
      </button>
    </fetcher.Form>
  );
}
