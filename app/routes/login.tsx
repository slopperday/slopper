import { Form, redirect } from "react-router";
import type { Route } from "./+types/login";
import { config } from "~/.server/config";
import { safeReturnTo } from "~/.server/auth/oauth";
import { viewerContext } from "~/.server/session";
import { OAUTH_LABELS, OAUTH_PROVIDERS } from "~/lib/model";
import { seo } from "~/lib/seo";
import { Splat } from "~/components/Logo";
import { ProviderIcon } from "~/components/ProviderIcon";

export function loader({ request, context }: Route.LoaderArgs) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  if (context.get(viewerContext).user) throw redirect(returnTo);
  return {
    returnTo,
    /** Providers with keys on this server, in the order they're offered. */
    providers: OAUTH_PROVIDERS.filter((provider) => config[provider] !== null),
    devLogin: config.devLogin,
  };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Start slopping", path: "/login" });

export default function Login({ loaderData }: Route.ComponentProps) {
  const query = `?intent=login&returnTo=${encodeURIComponent(loaderData.returnTo)}`;
  return (
    <section className="mx-auto grid max-w-md px-4 pt-14">
      <div>
        <Splat className="h-24 w-auto" />
        <h1 className="title-1 mt-6">Start slopping</h1>
        <p className="lede mt-3">Sign in to set a goal and throw your first slop.</p>
        <div className="mt-8 grid gap-3">
          {loaderData.providers.map((provider) => (
            <a
              key={provider}
              href={`/auth/${provider}${query}`}
              className={`btn btn-lg w-full ${provider === "github" ? "btn-ink" : ""}`}
            >
              <ProviderIcon provider={provider} /> Continue with {OAUTH_LABELS[provider]}
            </a>
          ))}
          {loaderData.providers.length === 0 && !loaderData.devLogin && (
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
