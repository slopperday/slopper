import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import { useEffect } from "react";
import { AnalyticsProvider, useAnalytics, useIdentify } from "@slopperday/analytics/react";
import type { Route } from "./+types/root";
import {
  analyticsIdContext,
  analyticsMiddleware,
  analyticsOptedOut,
  analyticsSetup,
  countryOf,
} from "./.server/analytics";
import { autopostNetworks, config } from "./.server/config";
import { flagProperties, flagsFor } from "./.server/flags";
import { runningSurveys } from "./.server/surveys";
import { readCookie, redirectQueryMiddleware } from "./.server/http";
import { MOTION_COOKIE, parseMotion } from "./lib/motion";
import { csrfMiddleware, viewerContext, viewerMiddleware } from "./.server/session";
import { permissionsOf } from "@convex/lib/permissions";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { SurveyCard } from "./components/SurveyCard";
import { FlashBanner } from "./components/FlashBanner";
import { LiveProvider } from "./components/Live";
import { RenderTimeProvider } from "./components/RelativeTime";
import { Tiles } from "./components/Tiles";
import { mayRecordPath, sanitizeAnalyticsPath } from "./lib/analytics";
import { withoutRedirectMarker } from "./lib/redirect";
import "./app.css";
import bigShouldersLatin from "@fontsource-variable/big-shoulders/files/big-shoulders-latin-standard-normal.woff2?url";
import schibstedGroteskLatin from "@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2?url";

// redirectQueryMiddleware goes first so it sees every redirect, the others' included.
export const middleware: Route.MiddlewareFunction[] = [
  redirectQueryMiddleware,
  csrfMiddleware,
  viewerMiddleware,
  analyticsMiddleware,
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const viewer = context.get(viewerContext);
  const user = viewer.user;
  const analytics = analyticsSetup(request);
  const optedOut = analyticsOptedOut(request);
  const [flags, surveys] = await Promise.all([
    // Signed-in people are bucketed by account, so a flag follows them between devices.
    flagsFor(user?._id ?? context.get(analyticsIdContext), flagProperties(user, countryOf(request), Date.now())),
    // Answers are analytics: nobody who turned it off is asked.
    analytics && !optedOut ? runningSurveys() : Promise.resolve([]),
  ]);
  return {
    renderedAt: Date.now(),
    user: user
      ? { id: user._id, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }
      : null,
    permissions: permissionsOf(user),
    flash: viewer.flash,
    origin: config.appUrl.origin,
    convexUrl: config.convexUrl,
    commentsEnabled: config.commentsEnabled,
    autopostNetworks: autopostNetworks(),
    analytics,
    analyticsOptedOut: optedOut,
    surveys,
    motion: parseMotion(readCookie(request, MOTION_COOKIE)),
    flags,
  };
}

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  // Lets phones install Slopper, which iOS needs before it shows notifications.
  { rel: "manifest", href: "/manifest.webmanifest" },
  // Every page opens with both faces (app.css declares them), so fetch them alongside the
  // stylesheet instead of after it, and they're usually in before the first paint.
  { rel: "preload", href: bigShouldersLatin, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "preload", href: schibstedGroteskLatin, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
  { rel: "alternate", type: "application/rss+xml", title: "Slopper: fresh slop", href: "/feed.xml" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const location = useLocation();
  useEffect(() => {
    // Tells the server the visitor's time zone, so clock times show in it
    // and a new account starts in their zone, before anyone has signed in.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const secure = window.isSecureContext ? "; secure" : "";
    document.cookie = `slopper_tz=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax${secure}`;
  }, []);
  useEffect(() => {
    // Replacing the entry in place keeps React Router from loading the page again.
    const clean = withoutRedirectMarker(window.location.href);
    if (clean !== null) window.history.replaceState(window.history.state, "", clean);
  }, [location.key]);
  return (
    <html lang="en" data-motion={data?.motion ?? undefined}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#f4f5f0" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#121410" media="(prefers-color-scheme: dark)" />
        <Meta />
        <Links />
      </head>
      <body className="flex min-h-dvh flex-col">
        <AnalyticsProvider
          options={
            data?.analytics
              ? {
                  ...data.analytics,
                  sanitizePath: sanitizeAnalyticsPath,
                  replay: data.analytics.replay && { ...data.analytics.replay, mayRecord: mayRecordPath },
                }
              : null
          }
          flags={data?.flags}
        >
          <IdentifyViewer user={data?.user ?? null} />
          <LiveProvider url={data?.convexUrl ?? null} signedIn={Boolean(data?.user)}>
            <a
              href="#main"
              className="btn btn-ink sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
            >
              Skip to content
            </a>
            <Header user={data?.user ?? null} permissions={data?.permissions ?? []} path={location.pathname} />
            {data?.flash && <FlashBanner key={location.key} flash={data.flash} />}
            <main id="main" className="flex-1">
              {data ? <RenderTimeProvider renderedAt={data.renderedAt}>{children}</RenderTimeProvider> : children}
            </main>
            <Footer />
            <SurveyCard surveys={data?.surveys ?? []} signedIn={Boolean(data?.user)} />
          </LiveProvider>
        </AnalyticsProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

/**
 * Signed-in people are their user id in analytics, the id Convex captures
 * their launches and votes with (convex/analytics.ts), so what they did
 * before signing in joins their account's history.
 */
function IdentifyViewer({ user }: { user: { id: string; username: string } | null }) {
  useIdentify(user ? { distinctId: user.id, set: { username: user.username } } : null);
  return null;
}

/**
 * Sends what the error boundary caught to analytics. Errors thrown on the
 * server reach the browser as "Unexpected Server Error" (React Router hides
 * the rest): the server reported those itself (app/.server/errors.ts).
 */
function ReportError({ error }: { error: unknown }) {
  const client = useAnalytics();
  useEffect(() => {
    if (!client || isRouteErrorResponse(error)) return;
    if (error instanceof Error && error.message === "Unexpected Server Error") return;
    client.captureException(error, { boundary: "root" });
  }, [client, error]);
  return null;
}

const ERROR_COPY: Record<number, { title: string; body: string }> = {
  401: { title: "Sign in first", body: "You need an account for that." },
  403: { title: "Not yours", body: "That isn't yours to touch." },
  404: { title: "Slid off the wall", body: "Nothing here. It never existed, or its owner scraped it off." },
};

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  const copy = ERROR_COPY[status] ?? {
    title: "Something broke",
    body: "That one's on us. Try again in a moment.",
  };
  const stack = import.meta.env.DEV && error instanceof Error ? error.stack : undefined;
  return (
    <section className="mx-auto grid max-w-xl justify-items-center px-4 py-20 text-center">
      <ReportError error={error} />
      <title>{`${copy.title} · Slopper`}</title>
      <Tiles value={String(status)} className="text-[3.5rem]" />
      <p className="sr-only">Error {status}</p>
      <h1 className="title-1 mt-8">{copy.title}</h1>
      <p className="lede mt-4">{copy.body}</p>
      <a href="/" className="btn btn-slop btn-lg mt-8">
        Back to the wall
      </a>
      {stack && (
        <pre className="mt-10 w-full overflow-x-auto rounded-xl bg-sunk p-4 text-left font-mono text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </section>
  );
}
