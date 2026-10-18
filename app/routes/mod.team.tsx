import { Form, Link } from "react-router";
import type { Route } from "./+types/mod.team";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { StaffRole } from "@convex/lib/permissions";
import type { StaffLogEntry, TeamMember } from "@convex/team";
import { config } from "~/.server/config";
import { convex, convexMessage } from "~/.server/convex";
import { formText } from "~/.server/forms";
import { outOfDateForm, redirectWithFlash } from "~/.server/http";
import { requireStaff, viewerContext } from "~/.server/session";
import { timeAgo } from "~/lib/dates";
import { seo } from "~/lib/seo";
import { typedUsername } from "~/lib/username";
import { Avatar } from "~/components/Avatar";
import { EmptyState } from "~/components/Shared";

/**
 * The moderation team, for admins: find an account by username, then make it
 * a moderator or an admin, or take it off the team. Whoever signs in with an
 * account in ADMIN_IDENTITIES is always an admin, so they have no buttons
 * here. Below the team, the staff log: every use of a staff power.
 */

const ROLE_CHANGES = {
  moderator: { label: "Make moderator", message: "is a moderator now" },
  admin: { label: "Make admin", message: "is an admin now" },
  none: { label: "Take off the team", message: "is off the team" },
} as const;

type RoleChange = keyof typeof ROLE_CHANGES;

function isRoleChange(value: string): value is RoleChange {
  return Object.hasOwn(ROLE_CHANGES, value);
}

/** The accounts that sign in with an account in ADMIN_IDENTITIES, which keeps them admins. */
async function listedAdmins(): Promise<{ id: Id<"users">; username: string }[]> {
  if (config.adminIdentities.length === 0) return [];
  return await convex.query(api.team.listed, { identities: [...config.adminIdentities] });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  requireStaff(context.get(viewerContext), request, "team.manage");
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const [members, results, listed, log] = await Promise.all([
    convex.query(api.team.members, {}),
    query ? convex.query(api.team.search, { prefix: query }) : [],
    listedAdmins(),
    convex.query(api.team.log, {}),
  ]);
  const listedIds = new Set(listed.map((admin) => admin.id));
  // A listed admin who hasn't signed in since is an admin all the same.
  const withListing = (member: TeamMember) => {
    const always = listedIds.has(member.id);
    return { ...member, role: always ? ("admin" as const) : member.role, listed: always };
  };
  return { members: members.map(withListing), results: results.map(withListing), query, log };
}

export async function action({ request, context }: Route.ActionArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "team.manage");
  const form = await request.formData();
  const change = formText(form, "role");
  const username = formText(form, "username");
  const query = formText(form, "q");
  const back = query ? `/mod/team?q=${encodeURIComponent(query)}` : "/mod/team";
  if (!isRoleChange(change)) return outOfDateForm(back);
  const listed = await listedAdmins();
  if (change !== "admin" && listed.some((member) => member.username === typedUsername(username))) {
    return redirectWithFlash(back, {
      tone: "error",
      message: `@${username} stays an admin.`,
    });
  }
  try {
    const member = await convex.mutation(api.team.setRole, {
      adminId: admin._id,
      username,
      role: change === "none" ? null : change,
    });
    return redirectWithFlash(back, {
      tone: "success",
      message: `@${member.username} ${ROLE_CHANGES[change].message}.`,
    });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return redirectWithFlash(back, { tone: "error", message });
    throw error;
  }
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Moderation team", noindex: true });

type Member = Route.ComponentProps["loaderData"]["members"][number];

const ROLE_NAMES: Record<StaffRole, string> = { admin: "Admin", moderator: "Moderator" };

export default function Team({ loaderData }: Route.ComponentProps) {
  const { members, results, query, log } = loaderData;
  return (
    <section className="mx-auto max-w-4xl px-4 pt-14">
      <p>
        <Link to="/mod" className="link">
          Moderation
        </Link>
      </p>
      <h1 className="title-1 mt-2">Moderation team</h1>
      <p className="lede mt-4 max-w-2xl">
        Moderators approve or reject videos and flagged slops. Admins can do everything.
      </p>

      <section className="mt-12" aria-labelledby="team-title">
        <h2 id="team-title" className="title-2">
          The team
        </h2>
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {members.map((member) => (
            <MemberRow key={member.id} member={member} query={query} />
          ))}
        </ul>
      </section>

      <section className="mt-12" aria-labelledby="add-title">
        <h2 id="add-title" className="title-2">
          Add someone
        </h2>
        <Form method="get" className="mt-6 flex flex-wrap gap-2" role="search">
          <input
            name="q"
            defaultValue={query}
            className="input max-w-xs"
            placeholder="@username"
            aria-label="Username"
            autoComplete="off"
          />
          <button type="submit" className="btn bg-raised">
            Find
          </button>
        </Form>
        {query && (
          <div className="mt-6">
            {results.length === 0 ? (
              <EmptyState>Nobody's username starts with “{query}”.</EmptyState>
            ) : (
              <ul className="divide-y divide-line border-y border-line" aria-label="Accounts found">
                {results.map((member) => (
                  <MemberRow key={member.id} member={member} query={query} />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="mt-12" aria-labelledby="log-title">
        <h2 id="log-title" className="title-2">
          Staff log
        </h2>
        <p className="mt-2 max-w-2xl text-muted">Who on the team did what, newest first.</p>
        {log.length === 0 ? (
          <div className="mt-6">
            <EmptyState>Nothing yet.</EmptyState>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-line border-y border-line">
            {log.map((entry) => (
              <li key={entry.id} className="py-2.5">
                <span className="font-bold">{entry.actor ? `@${entry.actor}` : "A deleted account"}</span>{" "}
                {describe(entry)}
                <span className="ml-2 text-sm text-muted">{timeAgo(entry.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

/** What a staff log entry says its actor did. */
function describe({ action, target }: StaffLogEntry): string {
  switch (action.type) {
    case "role":
      return action.role
        ? `made ${target} ${action.role === "admin" ? "an admin" : "a moderator"}`
        : `took ${target} off the team`;
    case "listedAdmin":
      return "became an admin when they signed in";
    case "flags":
      return {
        fine: `cleared the flags on ${target}`,
        nsfw: `kept ${target} up, blurred as NSFW`,
        hide: `hid ${target} after its flags`,
      }[action.decision];
    case "video":
      return action.approved ? `approved ${target}'s video` : `took ${target}'s video off`;
    case "takeDown":
      return `took down ${target}'s video`;
    case "trust":
      return action.trusted ? `trusted ${target}` : `stopped trusting ${target}`;
    case "hidden":
      return action.hidden ? `hid ${target}` : `brought ${target} back`;
    case "deleteSlop":
      return `deleted ${target}`;
    case "deleteComment":
      return `deleted a comment on ${target}`;
  }
}

function MemberRow({ member, query }: { member: Member; query: string }) {
  const changes = (Object.keys(ROLE_CHANGES) as RoleChange[]).filter((change) =>
    change === "none" ? member.role !== null : change !== member.role,
  );
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3" aria-label={`@${member.username}`}>
      <p className="flex items-center gap-3">
        <Avatar user={member} />
        <span>
          <Link to={`/@${member.username}`} className="font-bold hover:underline">
            @{member.username}
          </Link>
          <span className="ml-2 text-muted">{member.role ? ROLE_NAMES[member.role] : "Not on the team"}</span>
        </span>
      </p>
      {!member.listed && (
        <Form method="post" className="flex flex-wrap gap-2">
          <input type="hidden" name="username" value={member.username} />
          <input type="hidden" name="q" value={query} />
          {changes.map((change) => (
            <button
              key={change}
              type="submit"
              name="role"
              value={change}
              className={`btn btn-sm ${change === "none" ? "bg-raised" : "btn-slop"}`}
            >
              {ROLE_CHANGES[change].label}
            </button>
          ))}
        </Form>
      )}
    </li>
  );
}
