import { Link, NavLink } from "react-router";

const TABS = [
  { to: "/analytics", label: "Overview", end: true },
  { to: "/analytics/traffic", label: "Traffic", end: false },
  { to: "/analytics/insights", label: "Insights", end: false },
  { to: "/analytics/people", label: "People", end: false },
  { to: "/analytics/recordings", label: "Recordings", end: false },
  { to: "/analytics/heatmaps", label: "Heatmaps", end: false },
  { to: "/analytics/errors", label: "Errors", end: false },
  { to: "/analytics/speed", label: "Speed", end: false },
  { to: "/analytics/flags", label: "Flags", end: false },
  { to: "/analytics/experiments", label: "Experiments", end: false },
  { to: "/analytics/surveys", label: "Surveys", end: false },
] as const;

/** The analytics pages' heading and tabs. */
export function AnalyticsNav({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header>
      <p className="caps text-muted">Analytics · admins only</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="title-1">{title}</h1>
        {children}
      </div>
      <nav aria-label="Analytics" className="mt-6 flex flex-wrap gap-2 border-b border-line pb-3">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => `btn btn-sm ${isActive ? "btn-ink" : "btn-quiet"}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

/** Links to the same page for another number of days, keeping the rest of the URL. */
export function DaysPicker({ days, choices, search }: { days: number; choices: readonly number[]; search: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Time range">
      {choices.map((choice) => {
        const params = new URLSearchParams(search);
        params.set("days", String(choice));
        return (
          <Link
            key={choice}
            to={`?${params.toString()}`}
            aria-current={choice === days ? "true" : undefined}
            className={`btn btn-sm ${choice === days ? "btn-ink" : "bg-raised"}`}
            preventScrollReset
          >
            {choice}d
          </Link>
        );
      })}
    </div>
  );
}
