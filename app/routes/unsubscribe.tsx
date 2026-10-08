import { data, Form, Link } from "react-router";
import type { Route } from "./+types/unsubscribe";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { seo } from "~/lib/seo";

/** `crypto.randomUUID()`, as Convex makes them. */
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Unsubscribe", noindex: true });

/**
 * Stops the daily digest. Mail apps post here themselves when someone
 * presses their Unsubscribe button (RFC 8058); the link in the email opens
 * this page, whose button does the same. Opening the page alone changes
 * nothing, so link scanners can't unsubscribe anyone.
 */
export async function action({ params }: Route.ActionArgs) {
  const result = TOKEN.test(params.token)
    ? await convex.mutation(api.users.unsubscribe, { token: params.token })
    : null;
  return data({ done: result !== null }, { status: result ? 200 : 404 });
}

export default function Unsubscribe({ actionData }: Route.ComponentProps) {
  return (
    <section className="mx-auto max-w-xl px-4 pt-14">
      <h1 className="title-1">Daily digest</h1>
      {actionData?.done ? (
        <p role="status" className="mt-6 text-lg">
          Done. No more digests. Turn them back on any time in{" "}
          <Link to="/settings#email-digest" className="underline">
            Settings
          </Link>
          .
        </p>
      ) : actionData ? (
        <p role="alert" className="mt-6 text-lg">
          That link doesn't match an account. Turn the digest off in{" "}
          <Link to="/settings#email-digest" className="underline">
            Settings
          </Link>{" "}
          instead.
        </p>
      ) : (
        <Form method="post" className="mt-6 grid justify-items-start gap-6">
          <p className="text-lg">Stop the daily email about your slops?</p>
          <button type="submit" className="btn btn-ink btn-lg">
            Stop the digest
          </button>
        </Form>
      )}
    </section>
  );
}
