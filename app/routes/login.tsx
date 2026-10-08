import { Form, redirect } from "react-router";
import type { Route } from "./+types/login";
import { config } from "~/.server/config";
import { safeReturnTo } from "~/.server/auth/oauth";
import { viewerContext } from "~/.server/session";
import { seo } from "~/lib/seo";
import { Splat } from "~/components/Logo";

export function loader({ request, context }: Route.LoaderArgs) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  if (context.get(viewerContext).user) throw redirect(returnTo);
  return {
    returnTo,
    github: config.github !== null,
    google: config.google !== null,
    devLogin: config.devLogin,
  };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Start slopping", path: "/login" });

export default function Login({ loaderData }: Route.ComponentProps) {
  const query = `?returnTo=${encodeURIComponent(loaderData.returnTo)}`;
  const nothingConfigured = !loaderData.github && !loaderData.google;
  return (
    <section className="mx-auto grid max-w-md px-4 pt-14">
      <div>
        <Splat className="h-24 w-auto" />
        <h1 className="title-1 mt-6">Start slopping</h1>
        <p className="lede mt-3">Sign in to set a goal and throw your first slop.</p>
        <div className="mt-8 grid gap-3">
          {loaderData.github && (
            <a href={`/auth/github${query}`} className="btn btn-ink btn-lg w-full">
              <GitHubIcon /> Continue with GitHub
            </a>
          )}
          {loaderData.google && (
            <a href={`/auth/google${query}`} className="btn btn-lg w-full">
              <GoogleIcon /> Continue with Google
            </a>
          )}
          {nothingConfigured && !loaderData.devLogin && (
            <p className="panel text-[0.9375rem] text-muted">
              No sign-in providers are configured. Set <code className="font-mono">GITHUB_CLIENT_ID</code> and{" "}
              <code className="font-mono">GITHUB_CLIENT_SECRET</code>.
            </p>
          )}
        </div>
        {loaderData.devLogin && (
          <Form method="post" action="/auth/dev" className="panel mt-8">
            <input type="hidden" name="returnTo" value={loaderData.returnTo} />
            <label htmlFor="dev-username" className="field-label">
              Local dev login
            </label>
            <div className="flex gap-2">
              <input
                id="dev-username"
                name="username"
                className="input"
                placeholder="username"
                required
                pattern="[a-zA-Z0-9_\-]{1,30}"
              />
              <button type="submit" className="btn btn-slop">
                Go
              </button>
            </div>
            <p className="field-hint">Only on your machine. Disabled in production.</p>
          </Form>
        )}
        <p className="mt-8 text-sm text-muted">
          By signing in you agree to the{" "}
          <a href="/terms" className="underline">
            terms
          </a>{" "}
          and{" "}
          <a href="/rules" className="underline">
            rules
          </a>
          . Here's{" "}
          <a href="/privacy" className="underline">
            what we keep
          </a>
          .
        </p>
      </div>
    </section>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
