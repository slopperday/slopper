import { Form, Link, NavLink } from "react-router";
import { NotificationsBell } from "./NotificationsBell";
import { Avatar } from "./Avatar";
import { Countdown } from "./Countdown";
import { Icon } from "./Icon";
import { Wordmark } from "./Logo";

const NAV = [
  { to: "/today", label: "Today" },
  { to: "/wall", label: "The wall" },
  { to: "/slopcessful", label: "Slopcessful" },
  { to: "/streaks", label: "Streaks" },
];

/** Full-height links; the active one sits on a lime bar along the header's edge. */
function navClass({ isActive }: { isActive: boolean }) {
  return `relative flex h-full shrink-0 items-center px-1.5 text-[0.875rem] font-bold whitespace-nowrap transition-colors after:absolute after:inset-x-1.5 after:bottom-0 after:h-[3px] after:rounded-t-full min-[430px]:px-2.5 min-[430px]:text-[0.9375rem] min-[430px]:after:inset-x-2.5 md:px-3 md:after:inset-x-3 ${
    isActive ? "text-ink after:bg-slop" : "text-muted hover:text-ink"
  }`;
}

export interface HeaderUser {
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export function Header({ user, isAdmin, path }: { user: HeaderUser | null; isAdmin: boolean; path: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ground/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:gap-6">
        <Link to="/" className="-my-1 shrink-0 py-1" aria-label="Slopper home">
          <Wordmark />
        </Link>
        <nav className="hidden h-full items-stretch md:flex" aria-label="Main">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
          <span className="hidden lg:inline-flex">
            <Countdown className="text-[1.15rem]" />
          </span>
          {user ? (
            <>
              <NotificationsBell />
              <Link to="/new" className="btn btn-slop btn-sm">
                <Icon name="plus" className="size-4" />
                <span className="max-[359px]:sr-only">New slop</span>
              </Link>
              <details className="relative" key={path}>
                <summary className="list-none rounded-full p-1" aria-label="Account menu">
                  <Avatar user={user} size="md" />
                </summary>
                <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-raised p-2 shadow-[0_18px_40px_-16px_rgb(0_0_0/0.45)]">
                  <p className="px-3 pt-2 pb-1 text-sm text-muted">Signed in as @{user.username}</p>
                  <MenuLink to={`/@${user.username}`}>Your slops</MenuLink>
                  <MenuLink to="/goal">Your goal</MenuLink>
                  <MenuLink to="/settings/autopost">Auto-post</MenuLink>
                  <MenuLink to="/settings">Settings</MenuLink>
                  {isAdmin && <MenuLink to="/mod">Flag queue</MenuLink>}
                  <Form method="post" action="/auth/logout" className="mt-1 border-t border-line pt-1">
                    <button
                      type="submit"
                      className="flex min-h-11 w-full items-center rounded-xl px-3 text-left font-bold hover:bg-sunk"
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
      <nav className="flex h-11 items-stretch border-t border-line md:hidden" aria-label="Main mobile">
        {/* The links scroll sideways on the narrowest phones. */}
        <div className="scrollbar-none flex min-w-0 flex-1 overflow-x-auto px-2">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={navClass}>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </header>
  );
}

function MenuLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="flex min-h-11 items-center rounded-xl px-3 font-bold hover:bg-sunk">
      {children}
    </Link>
  );
}
