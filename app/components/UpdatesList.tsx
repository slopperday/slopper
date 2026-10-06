import { Link } from "react-router";
import { type PublicSlop, type PublicUser, type SlopUpdate, UPDATE_KINDS, type UpdateKind } from "~/lib/model";
import { markdownToPlain } from "~/lib/compose";
import { slopPath } from "~/lib/display";
import { timeAgo } from "~/lib/dates";
import { Avatar } from "./Avatar";

export interface UpdateEntry {
  update: Pick<SlopUpdate, "id" | "kind" | "body" | "createdAt">;
  slop: Pick<PublicSlop, "name" | "slug">;
  owner: PublicUser;
}

export const UPDATE_KIND_STYLES: Record<UpdateKind, string> = {
  launch: "bg-ink text-wall",
  update: "bg-card",
  feature: "bg-slop text-slop-ink",
  field: "bg-[#5ec8ff] text-[#151513]",
  repromote: "bg-card",
  slopcessful: "bg-gold text-[#151513]",
};

/** Recent updates across every slop. */
export function UpdatesList({ entries }: { entries: UpdateEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="mt-5 rounded-xl border-2 border-dashed border-ink/40 p-6 text-sm text-muted">
        No updates yet. New features, fixes and re-promotes show up here.
      </p>
    );
  }
  return (
    <ol className="mt-5 grid gap-3">
      {entries.map(({ update, slop, owner }) => (
        <li
          key={update.id}
          className="relative flex gap-3 rounded-xl border-2 border-ink bg-card p-4 transition-transform hover:-translate-y-0.5"
        >
          <Avatar user={owner} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-bold">@{owner.username}</span>
              <span className={`chip ${UPDATE_KIND_STYLES[update.kind]}`}>{UPDATE_KINDS[update.kind].label}</span>
              <Link
                to={`${slopPath(owner.username, slop.slug)}#update-${update.id}`}
                className="font-black after:absolute after:inset-0 after:content-['']"
              >
                {slop.name}
              </Link>
              <span className="ml-auto font-mono text-[0.65rem] text-muted">{timeAgo(update.createdAt)}</span>
            </p>
            <p className="mt-1.5 line-clamp-2 text-sm text-muted">{markdownToPlain(update.body)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
