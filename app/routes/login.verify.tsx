import { useState } from "react";
import { Form, useNavigation } from "react-router";
import type { Route } from "./+types/login.verify";
import { api } from "@convex/_generated/api";
import { cancelStep, checkCode, finishStep, pendingStep } from "~/.server/auth/twoFactor";
import { convex } from "~/.server/convex";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { viewerContext } from "~/.server/session";
import { allowAction, callerAddress } from "~/.server/tokens";
import { seo } from "~/lib/seo";

/**
 * The second step of signing in, and confirming it's you before a sensitive
 * action: a passkey, a code from an authenticator app, or a recovery code.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const step = await pendingStep(request, context.get(viewerContext));
  if (!step) return redirectWithFlash("/login", { tone: "error", message: "That took too long. Sign in again." });
  const factors = await convex.query(api.security.factors, { userId: step.userId });
  return {
    confirming: step.kind === "stepup",
    totp: factors.totp,
    passkeys: factors.passkeys.length > 0,
    recoveryLeft: factors.recoveryLeft,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const viewer = context.get(viewerContext);
  const form = await request.formData();
  if (formText(form, "intent") === "cancel") {
    const step = await pendingStep(request, viewer);
    const headers = await cancelStep(request, step);
    headers.set("location", step?.kind === "stepup" ? step.returnTo : "/login");
    return new Response(null, { status: 302, headers });
  }
  if (!(await allowAction(`two-factor:${callerAddress(request)}`, 30, 900_000))) {
    return { error: "Too many tries. Wait 15 minutes, then try again." };
  }
  const step = await pendingStep(request, viewer);
  if (!step) return redirectWithFlash("/login", { tone: "error", message: "That took too long. Sign in again." });
  const result = await checkCode(step, formText(form, "code"));
  if (!result.ok) return { error: result.error };
  return await finishStep(request, step, result.method);
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Confirm it's you", noindex: true });

export default function Verify({ loaderData, actionData }: Route.ComponentProps) {
  const { confirming, totp, passkeys, recoveryLeft } = loaderData;
  const navigation = useNavigation();
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [usingPasskey, setUsingPasskey] = useState(false);

  async function usePasskey() {
    setPasskeyError(null);
    setUsingPasskey(true);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const start = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "login-options" }),
      });
      const { options, error } = (await start.json()) as {
        options?: Parameters<typeof startAuthentication>[0]["optionsJSON"];
        error?: string;
      };
      if (!options) throw new Error(error ?? "Couldn't start.");
      const response = await startAuthentication({ optionsJSON: options });
      const done = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "login-verify", response }),
      });
      const answer = (await done.json()) as { location?: string; error?: string };
      if (!answer.location) throw new Error(answer.error ?? "That passkey didn't check out.");
      window.location.assign(answer.location);
    } catch (error) {
      const cancelled = error instanceof Error && error.name === "NotAllowedError";
      setPasskeyError(
        cancelled
          ? "The passkey was cancelled. Try again, or use a code."
          : error instanceof Error
            ? error.message
            : "That didn't work.",
      );
      setUsingPasskey(false);
    }
  }

  return (
    <section className="mx-auto max-w-md px-4 pt-14 pb-16">
      <h1 className="title-1">{confirming ? "Confirm it’s you" : "One more step"}</h1>
      <p className="lede mt-3">
        {confirming
          ? "This changes how your account signs in or posts, so confirm it’s you first."
          : "You turned on two-step sign-in. Prove it’s you to finish signing in."}
      </p>

      {passkeys && (
        <div className="panel mt-8">
          <button
            type="button"
            className="btn btn-slop w-full"
            onClick={() => void usePasskey()}
            disabled={usingPasskey}
          >
            {usingPasskey ? "Waiting for your passkey…" : "Use a passkey"}
          </button>
          {passkeyError && (
            <p className="mt-2 text-sm text-hot" role="alert">
              {passkeyError}
            </p>
          )}
        </div>
      )}

      <Form method="post" className="panel mt-4 grid gap-3" data-no-capture data-no-replay>
        <label className="grid gap-1 font-bold">
          {totp ? "Code from your authenticator app" : "Recovery code"}
          <input
            name="code"
            className="input font-mono text-lg tracking-widest"
            inputMode={totp ? "numeric" : "text"}
            autoComplete="one-time-code"
            autoFocus={!passkeys}
            required
            maxLength={20}
            placeholder={totp ? "123 456" : "abcd-efgh"}
          />
        </label>
        {totp && recoveryLeft > 0 && (
          <p className="text-sm text-muted">Lost your phone? A recovery code works here too.</p>
        )}
        <button type="submit" name="intent" value="code" className="btn btn-ink" disabled={navigation.state !== "idle"}>
          {navigation.state !== "idle" ? "Checking…" : "Continue"}
        </button>
        {actionData?.error && (
          <p className="text-sm text-hot" role="alert">
            {actionData.error}
          </p>
        )}
      </Form>

      <Form method="post" className="mt-4">
        <button type="submit" name="intent" value="cancel" className="btn btn-quiet btn-sm" formNoValidate>
          {confirming ? "Cancel" : "Sign in a different way"}
        </button>
      </Form>
    </section>
  );
}
