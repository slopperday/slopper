import { Link } from "react-router";
import type { PublicUser } from "@convex/lib/shape";
import { UPDATE_KINDS, type UpdateKind } from "~/lib/model";
import { markdownToPlain } from "~/lib/compose";
import { slopPath } from "~/lib/display";
import { timeAgo } from "~/lib/dates";
import { Avatar } from "./Avatar";
import { EmptyState } from "./Shared";

export interface UpdateEntry {
  update: { id: string; kind: UpdateKind; body: string; createdAt: number };
  slop: { name: string; slug: string };
  owner: PublicUser;
}

/** Launches and slopcessful moments get their colour; everything else stays ink. */
export const UPDATE_KIND_TONES: Record<UpdateKind, string> = {
  launch: "text-slop-text",
  update: "text-muted",
  feature: "text-muted",
  field: "text-muted",
  repromote: "text-muted",
  slopcessful: "text-gold-text",
};

/** Recent updates across every slop. */
export function UpdatesList({ entries }: { entries: UpdateEntry[] }) {
  if (entries.length === 0) {
    return <EmptyState>No updates yet.</EmptyState>;
  }
  return (
    <ol className="divide-y divide-line border-y border-line">
      {entries.map(({ update, slop, owner }) => (
        <li key={update.id} className="group relative flex gap-3 py-4">
          <Avatar user={owner} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Link
                to={`${slopPath(owner.username, slop.slug)}#update-${update.id}`}
                className="font-bold after:absolute after:inset-0 after:content-[''] group-hover:underline"
              >
                {slop.name}
              </Link>
              <span className={`caps text-[0.85rem] ${UPDATE_KIND_TONES[update.kind]}`}>
                {UPDATE_KINDS[update.kind].label}
              </span>
              <span className="ml-auto text-sm text-muted">{timeAgo(update.createdAt)}</span>
            </p>
            <p className="mt-0.5 line-clamp-2 text-muted">
              <span className="font-bold text-ink">@{owner.username}</span> {markdownToPlain(update.body)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
