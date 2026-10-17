import { Link } from "react-router";
import { APP_VERSION } from "~/lib/version";
import { Wordmark } from "./Logo";

const COLUMNS = [
  {
    title: "Look around",
    links: [
      { to: "/wall", label: "The wall" },
      { to: "/slopcessful", label: "Slopcessful" },
      { to: "/streaks", label: "Streaks" },
      { to: "/changelog", label: "What's new" },
      { to: "/feed.xml", label: "RSS", document: true },
    ],
  },
  {
    title: "Slop",
    links: [
      { to: "/goal", label: "Set a goal" },
      { to: "/rules", label: "Rules" },
      { to: "/terms", label: "Terms" },
      { to: "/privacy", label: "Privacy" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-32 border-t border-line">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 px-4 pt-14 pb-10 sm:grid-cols-[1.6fr_1fr_1fr]">
        <div className="col-span-2 sm:col-span-1">
          <Wordmark className="text-[2.75rem]" />
          <p className="mt-5 max-w-sm text-muted">
            Too much slop? Not enough yet! Throw it at the wall every day until one of them sticks.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <div key={column.title}>
            <p className="caps">{column.title}</p>
            <ul className="mt-2 grid">
              {column.links.map((link) => (
                <li key={link.to}>
                  {link.document ? (
                    <a href={link.to} className="inline-flex min-h-11 items-center font-bold hover:text-slop-text">
                      {link.label}
                    </a>
                  ) : (
                    <Link to={link.to} className="inline-flex min-h-11 items-center font-bold hover:text-slop-text">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mx-auto max-w-6xl px-4 pb-10 text-sm text-muted">
        slopper.day ·{" "}
        <Link to="/changelog" className="hover:text-slop-text">
          v{APP_VERSION}
        </Link>{" "}
        · keep slopping
      </p>
    </footer>
  );
}
