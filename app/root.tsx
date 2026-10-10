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
import type { Route } from "./+types/root";
import { autopostNetworks, config } from "./.server/config";
import { redirectQueryMiddleware } from "./.server/http";
import { csrfMiddleware, viewerContext, viewerMiddleware } from "./.server/session";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { FlashBanner } from "./components/FlashBanner";
import { LiveProvider } from "./components/Live";
import { Tiles } from "./components/Tiles";
import { withoutRedirectMarker } from "./lib/redirect";
import "./app.css";
import bigShouldersLatin from "@fontsource-variable/big-shoulders/files/big-shoulders-latin-standard-normal.woff2?url";
import schibstedGroteskLatin from "@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2?url";

// redirectQueryMiddleware goes first so it sees every redirect, the others' included.
export const middleware: Route.MiddlewareFunction[] = [redirectQueryMiddleware, csrfMiddleware, viewerMiddleware];

export function loader({ context }: Route.LoaderArgs) {
  const viewer = context.get(viewerContext);
  const user = viewer.user;
  return {
    user: user ? { username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl } : null,
    isAdmin: viewer.isAdmin,
    flash: viewer.flash,
    origin: config.appUrl.origin,
    convexUrl: config.convexUrl,
    commentsEnabled: config.commentsEnabled,
    autopostNetworks: autopostNetworks(),
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
    // Tells the server the visitor's time zone, so a goal day ends at their midnight
    // and a new account starts in their zone, before anyone has signed in.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    document.cookie = `slopper_tz=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
  }, []);
  useEffect(() => {
    // Replacing the entry in place keeps React Router from loading the page again.
    const clean = withoutRedirectMarker(window.location.href);
    if (clean !== null) window.history.replaceState(window.history.state, "", clean);
  }, [location.key]);
  return (
    <html lang="en">
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
        <LiveProvider url={data?.convexUrl ?? null} signedIn={Boolean(data?.user)}>
          <a
            href="#main"
            className="btn btn-ink sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
          >
            Skip to content
          </a>
          <Header user={data?.user ?? null} isAdmin={data?.isAdmin ?? false} path={location.pathname} />
          {data?.flash && <FlashBanner key={location.key} flash={data.flash} />}
          <main id="main" className="flex-1">
            {children}
          </main>
          <Footer />
        </LiveProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
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
