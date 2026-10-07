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
import type { Route } from "./+types/root";
import { config } from "./.server/config";
import { csrfMiddleware, viewerContext, viewerMiddleware } from "./.server/session";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { FlashBanner } from "./components/FlashBanner";
import { LiveProvider } from "./components/Live";
import "./app.css";

export const middleware: Route.MiddlewareFunction[] = [csrfMiddleware, viewerMiddleware];

export function loader({ context }: Route.LoaderArgs) {
  const viewer = context.get(viewerContext);
  const user = viewer.user;
  return {
    user: user ? { username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl } : null,
    isAdmin: viewer.isAdmin,
    flash: viewer.flash,
    origin: config.appUrl.origin,
    convexUrl: config.convexUrl,
  };
}

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Bagel+Fat+One&family=Martian+Mono:wdth,wght@75..112.5,300..800&display=swap",
  },
  { rel: "alternate", type: "application/rss+xml", title: "Slopper: fresh slop", href: "/feed.xml" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const location = useLocation();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#eeebe3" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#121211" media="(prefers-color-scheme: dark)" />
        <Meta />
        <Links />
      </head>
      <body className="flex min-h-dvh flex-col">
        <LiveProvider url={data?.convexUrl ?? null} signedIn={Boolean(data?.user)}>
          <a href="#main" className="btn sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50">
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
    <section className="mx-auto grid max-w-xl place-items-center px-4 py-24 text-center">
      <title>{`${copy.title} · Slopper`}</title>
      <p className="chip">Error {status}</p>
      <h1 className="font-wide mt-6 text-5xl font-black">{copy.title}</h1>
      <p className="mt-4 text-lg text-muted">{copy.body}</p>
      <a href="/" className="btn btn-slop mt-8">
        Back to the wall
      </a>
      {stack && (
        <pre className="mt-10 w-full overflow-x-auto rounded-lg bg-wall-deep p-4 text-left text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </section>
  );
}
