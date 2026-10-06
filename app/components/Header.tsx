import { Form, Link, NavLink } from "react-router";
import { NotificationsBell } from "./NotificationsBell";
import { Avatar } from "./Avatar";
import { Countdown } from "./Countdown";
import { Wordmark } from "./Logo";

const NAV = [
  { to: "/today", label: "Today" },
  { to: "/wall", label: "The wall" },
  { to: "/slopcessful", label: "Slopcessful" },
  { to: "/streaks", label: "Streaks" },
];

function navClass({ isActive }: { isActive: boolean }) {
  return `rounded-full px-3 py-1.5 font-mono text-xs uppercase tracking-wider ${
    isActive ? "bg-ink text-wall" : "hover:bg-wall-deep"
  }`;
}

export interface HeaderUser {
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export function Header({ user, path }: { user: HeaderUser | null; path: string }) {
  return (
    <header className="sticky top-0 z-40 border-b-2 border-ink bg-wall/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6">
        <Link to="/" className="shrink-0" aria-label="Slopper home">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span className="hidden sm:inline-flex">
            <Countdown />
          </span>
          {user ? (
            <>
              <NotificationsBell />
              <Link to="/new" className="btn btn-slop btn-sm">
                <span aria-hidden="true">+</span> New slop
              </Link>
              <details className="relative" key={path}>
                <summary
                  className="cursor-pointer list-none rounded-full [&::-webkit-details-marker]:hidden"
                  aria-label="Account menu"
                >
                  <Avatar user={user} />
                </summary>
                <div className="absolute right-0 mt-2 w-56 rounded-xl border-2 border-ink bg-card p-1.5 hard-shadow">
                  <p className="eyebrow px-3 pt-2 pb-1">@{user.username}</p>
                  <MenuLink to={`/@${user.username}`}>Your slops</MenuLink>
                  <MenuLink to="/goal">Your goal</MenuLink>
                  <MenuLink to="/settings/autopost">Auto-post</MenuLink>
                  <MenuLink to="/settings">Settings</MenuLink>
                  <Form method="post" action="/auth/logout">
                    <button
                      type="submit"
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-wall-deep"
                    >
                      Sign out
                    </button>
                  </Form>
                </div>
              </details>
            </>
          ) : (
            <Link to="/login" className="btn btn-slop btn-sm">
              Start slopping
            </Link>
          )}
        </div>
      </div>
      <nav className="flex items-center gap-2 border-t border-line py-1.5 pr-4 md:hidden" aria-label="Main mobile">
        {/* The links scroll sideways on narrow phones; the clock stays put. */}
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto px-4 [scrollbar-width:none]">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `shrink-0 rounded-full px-2.5 py-1 font-mono text-[0.65rem] tracking-wider whitespace-nowrap uppercase ${
                  isActive ? "bg-ink text-wall" : "hover:bg-wall-deep"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
        <span className="shrink-0 sm:hidden">
          <Countdown compact />
        </span>
      </nav>
    </header>
  );
}

function MenuLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-wall-deep">
      {children}
    </Link>
  );
}
