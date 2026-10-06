import { Link, useFetcher } from "react-router";

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

  const button = `inline-flex items-center justify-center rounded-full transition-colors ${
    large ? "size-11 text-lg" : "size-8 text-sm"
  }`;

  if (mode === "login") {
    return (
      <Link
        to={loginHref}
        className={`relative z-10 inline-flex items-center gap-1 rounded-full border-2 border-ink bg-card pr-3 font-mono font-bold tabular-nums hover:bg-slop ${
          large ? "text-base" : "text-xs"
        }`}
        title="Sign in to vote"
      >
        <span className={button} aria-hidden="true">
          ▲
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
      className={`relative z-10 inline-flex items-center rounded-full border-2 border-ink bg-card font-mono font-bold tabular-nums ${
        large ? "text-base" : "text-xs"
      }`}
    >
      <button
        type="submit"
        name="vote"
        value={upActive ? "0" : "1"}
        className={`${button} ${upActive ? "bg-slop text-slop-ink" : "hover:bg-slop/40"}`}
        aria-pressed={upActive}
        aria-label="Upvote"
        title={mode === "own" ? "Your own slop" : "This sticks"}
        disabled={mode === "own"}
      >
        ▲
      </button>
      <span className="min-w-6 px-1 text-center" aria-live="polite">
        {shownUpvotes}
      </span>
      <button
        type="submit"
        name="vote"
        value={downActive ? "0" : "-1"}
        className={`${button} opacity-70 ${downActive ? "bg-ink text-wall" : "hover:bg-wall-deep"}`}
        aria-pressed={downActive}
        aria-label="Downvote (private)"
        title="Not for me. Downvotes are private"
        disabled={mode === "own"}
      >
        ▼
      </button>
    </fetcher.Form>
  );
}
