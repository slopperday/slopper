import { Link } from "react-router";
import { LogoMark } from "./Logo";

export function Footer() {
  return (
    <footer className="mt-24 border-t-2 border-ink bg-ink text-wall">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <LogoMark size={28} />
            <span className="font-display text-2xl">slopper</span>
          </div>
          <p className="mt-3 max-w-sm text-sm text-wall/70">
            Everyone says slop is bad. Everything starts as slop. Throw it at the wall every day until one of them
            sticks.
          </p>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="font-mono text-[0.65rem] tracking-widest text-wall/50 uppercase">Look around</p>
          <Link to="/wall" className="hover:underline">
            The wall
          </Link>
          <Link to="/slopcessful" className="hover:underline">
            Slopcessful
          </Link>
          <Link to="/streaks" className="hover:underline">
            Streaks
          </Link>
          <a href="/feed.xml" className="hover:underline">
            RSS
          </a>
        </div>
        <div className="grid content-start gap-2 text-sm">
          <p className="font-mono text-[0.65rem] tracking-widest text-wall/50 uppercase">Slop</p>
          <Link to="/goal" className="hover:underline">
            Set a goal
          </Link>
          <Link to="/rules" className="hover:underline">
            Rules
          </Link>
          <Link to="/terms" className="hover:underline">
            Terms
          </Link>
          <Link to="/privacy" className="hover:underline">
            Privacy
          </Link>
        </div>
      </div>
      <div className="border-t border-wall/15">
        <p className="mx-auto max-w-6xl px-4 py-4 font-mono text-[0.65rem] tracking-widest text-wall/50 uppercase">
          slopper.day · keep slopping
        </p>
      </div>
    </footer>
  );
}
