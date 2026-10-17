import { Form, redirect } from "react-router";
import type { Route } from "./+types/cli";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { normalizeUserCode } from "~/.server/cliLogin";
import { formText } from "~/.server/forms";
import { seo } from "~/lib/seo";
import { Splat } from "~/components/Logo";
import { Tiles } from "~/components/Tiles";

/**
 * Where `slopper login` sends people: they check the code matches their
 * terminal and approve it, and the CLI collects its own API token
 * (convex/cliLogins.ts). Without a code in the link, they can type it.
 */

type View =
  | { kind: "enter" }
  | { kind: "unknown" }
  | { kind: "pending"; code: string; name: string }
  | { kind: "approved"; name: string }
  | { kind: "denied"; name: string };

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const raw = new URL(request.url).searchParams.get("code");
  const view = await viewFor(raw);
  return { view, username: user.username };
}

async function viewFor(raw: string | null): Promise<View> {
  if (!raw?.trim()) return { kind: "enter" };
  const code = normalizeUserCode(raw);
  const login = code ? await convex.query(api.cliLogins.lookup, { userCode: code }) : null;
  if (!code || !login) return { kind: "unknown" };
  if (login.status === "approved" || login.status === "used") return { kind: "approved", name: login.name };
  if (login.status === "denied") return { kind: "denied", name: login.name };
  if (login.expiresAt < Date.now()) return { kind: "unknown" };
  return { kind: "pending", code, name: login.name };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
  const code = normalizeUserCode(formText(form, "code"));
  if (code) {
    await convex.mutation(api.cliLogins.decide, {
      userId: user._id,
      userCode: code,
      approve: formText(form, "intent") === "approve",
    });
  }
  // Back to the page, so a reload doesn't send the decision again.
  throw redirect(`/cli?code=${encodeURIComponent(code ?? "")}`);
}

export const meta: Route.MetaFunction = ({ matches }) =>
  seo(matches, { title: "Sign in the CLI", path: "/cli", noindex: true });

export default function CliLogin({ loaderData }: Route.ComponentProps) {
  const { view, username } = loaderData;
  return (
    <section className="mx-auto grid max-w-lg px-4 pt-14">
      <Splat className="h-20 w-auto" />
      {view.kind === "pending" && (
        <>
          <h1 className="title-1 mt-6">Sign in the slopper CLI</h1>
          <p className="lede mt-3">Check this matches the code in your terminal.</p>
          <div className="board mt-6 flex justify-center px-5 py-6">
            <Tiles value={view.code.replace("-", " ")} className="text-[2.6rem] sm:text-[3.4rem]" />
            <span className="sr-only">{view.code}</span>
          </div>
          <p className="mt-6">
            <strong>{view.name}</strong> wants to act as <strong>@{username}</strong>: launch slops, post updates, vote
            and set goals.
          </p>
          <p className="mt-2 text-[0.9375rem] text-muted">
            Only approve a code you just asked for. Revoke its token any time in{" "}
            <a href="/settings/api" className="underline">
              Settings
            </a>
            .
          </p>
          <Form method="post" className="mt-8 grid grid-cols-2 gap-3">
            <input type="hidden" name="code" value={view.code} />
            <button type="submit" name="intent" value="approve" className="btn btn-slop btn-lg">
              Approve
            </button>
            <button type="submit" name="intent" value="deny" className="btn btn-lg">
              Deny
            </button>
          </Form>
        </>
      )}
      {view.kind === "approved" && (
        <>
          <h1 className="title-1 mt-6">The CLI is signed in</h1>
          <p className="lede mt-3">
            {view.name} now acts as @{username}. You can close this tab.
          </p>
          <p className="mt-6 text-[0.9375rem] text-muted">
            Revoke its token any time in{" "}
            <a href="/settings/api" className="underline">
              Settings
            </a>
            .
          </p>
        </>
      )}
      {view.kind === "denied" && (
        <>
          <h1 className="title-1 mt-6">Not signed in</h1>
          <p className="lede mt-3">
            {view.name} got nothing. Run <code className="font-mono">slopper login</code> to try again.
          </p>
        </>
      )}
      {(view.kind === "enter" || view.kind === "unknown") && (
        <>
          <h1 className="title-1 mt-6">
            {view.kind === "enter" ? "Sign in the slopper CLI" : "That code didn't work"}
          </h1>
          <p className="lede mt-3">
            {view.kind === "enter"
              ? "Type the code your terminal shows."
              : "Codes last ten minutes and work once. Run slopper login for a new one."}
          </p>
          <Form method="get" className="mt-8 flex gap-2">
            <label htmlFor="code" className="sr-only">
              Code
            </label>
            <input
              id="code"
              name="code"
              className="input font-mono uppercase"
              placeholder="BCDF-GHJK"
              autoComplete="off"
              required
            />
            <button type="submit" className="btn btn-slop">
              Continue
            </button>
          </Form>
        </>
      )}
    </section>
  );
}
