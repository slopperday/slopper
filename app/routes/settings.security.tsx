import { useState } from "react";
import { Form, useNavigation, useRevalidator } from "react-router";
import type { Route } from "./+types/settings.security";
import { api } from "@convex/_generated/api";
import {
  confirmTotpSetup,
  makeRecoveryCodes,
  pendingTotpSetup,
  requireRecentAuth,
  startTotpSetup,
} from "~/.server/auth/twoFactor";
import { convex } from "~/.server/convex";
import { hashToken } from "~/.server/encoding";
import { formText } from "~/.server/forms";
import { readCookie, redirectWithFlash, SESSION_COOKIE } from "~/.server/http";
import { requireUser, viewerContext } from "~/.server/session";
import { seo } from "~/lib/seo";
import { CopyButton, SettingsNav } from "~/components/Shared";

const HERE = "/settings/security";

export async function loader({ request, context }: Route.LoaderArgs) {
  const viewer = context.get(viewerContext);
  const user = requireUser(viewer, request);
  const factors = await convex.query(api.security.factors, { userId: user._id });
  // With two-step sign-in on, changing it is a sensitive action: confirm first.
  if (factors.enabled) await requireRecentAuth(viewer, request);
  const token = readCookie(request, SESSION_COOKIE);
  const [sessions, events] = await Promise.all([
    convex.query(api.security.sessions, { userId: user._id, currentHash: token ? await hashToken(token) : "" }),
    convex.query(api.security.events, { userId: user._id }),
  ]);
  return { factors, sessions, events, timeZone: user.timeZone };
}

export async function action({ request, context }: Route.ActionArgs) {
  const viewer = context.get(viewerContext);
  const user = requireUser(viewer, request);
  const form = await request.formData();
  const intent = formText(form, "intent");
  await requireRecentAuth(viewer, request, HERE);
  switch (intent) {
    case "totp-start":
      return { kind: "totp" as const, setup: await startTotpSetup(user), recoveryCodes: null, error: null };
    case "totp-confirm": {
      const result = await confirmTotpSetup(user, formText(form, "code"), request);
      if (!result.ok) {
        return { kind: "totp" as const, setup: await pendingTotpSetup(user), recoveryCodes: null, error: result.error };
      }
      return { kind: "codes" as const, setup: null, recoveryCodes: result.recoveryCodes, error: null };
    }
    case "totp-remove":
      await convex.mutation(api.security.removeTotp, { userId: user._id });
      return redirectWithFlash(HERE, { tone: "info", message: "Authenticator app removed." });
    case "passkey-remove":
      await convex.mutation(api.security.removePasskey, { userId: user._id, passkeyId: formText(form, "id") });
      return redirectWithFlash(HERE, { tone: "info", message: "Passkey removed." });
    case "recovery-new":
      return { kind: "codes" as const, setup: null, recoveryCodes: await makeRecoveryCodes(user._id), error: null };
    case "end-others": {
      const token = readCookie(request, SESSION_COOKIE);
      const ended = await convex.mutation(api.security.endOtherSessions, {
        userId: user._id,
        keepHash: token ? await hashToken(token) : "",
      });
      return redirectWithFlash(HERE, {
        tone: "success",
        message: ended ? `Signed out ${ended} other ${ended === 1 ? "session" : "sessions"}.` : "No other sessions.",
      });
    }
    case "end-session":
      await convex.mutation(api.security.endSession, { userId: user._id, sessionId: formText(form, "id") });
      return redirectWithFlash(HERE, { tone: "info", message: "Signed out." });
  }
  return redirectWithFlash(HERE);
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Security", noindex: true });

function browserName(agent: string | null): string {
  if (!agent) return "A browser";
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "A browser";
  const system = /iPhone|iPad/.test(agent)
    ? "iOS"
    : /Android/.test(agent)
      ? "Android"
      : /Mac OS X/.test(agent)
        ? "macOS"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : "";
  return system ? `${browser} on ${system}` : browser;
}

export default function Security({ loaderData, actionData }: Route.ComponentProps) {
  const { factors, sessions, events, timeZone } = loaderData;
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const codes = actionData?.recoveryCodes ?? newCodes;
  const when = (at: number) =>
    new Date(at).toLocaleString("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" });

  async function addPasskey() {
    setPasskeyError(null);
    setAdding(true);
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const start = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "register-options" }),
      });
      const plan = (await start.json()) as {
        options?: Parameters<typeof startRegistration>[0]["optionsJSON"];
        token?: string;
        error?: string;
        confirm?: boolean;
      };
      if (plan.confirm) {
        window.location.reload();
        return;
      }
      if (!plan.options || !plan.token) throw new Error(plan.error ?? "Couldn't start.");
      const response = await startRegistration({ optionsJSON: plan.options });
      const done = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "register-verify", token: plan.token, response, name: passkeyName || "Passkey" }),
      });
      const result = (await done.json()) as { ok: boolean; error?: string; recoveryCodes?: string[] | null };
      if (!result.ok) throw new Error(result.error ?? "That passkey didn't check out.");
      setPasskeyName("");
      if (result.recoveryCodes) setNewCodes(result.recoveryCodes);
      void revalidator.revalidate();
    } catch (error) {
      const cancelled = error instanceof Error && error.name === "NotAllowedError";
      setPasskeyError(cancelled ? "Cancelled." : error instanceof Error ? error.message : "That didn't work.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl px-4 pt-10 pb-16">
      <SettingsNav />
      <h1 className="title-1 mt-10">Security</h1>
      <p className="lede mt-4 max-w-2xl">
        Your Slopper account can post as every brand you’ve connected. Two-step sign-in means a stolen GitHub, Google,
        X, LinkedIn or Facebook login isn’t enough to get in.
      </p>

      <div className={`panel mt-8 ${factors.enabled ? "" : "border-2 border-hot"}`}>
        <h2 className="title-3">Two-step sign-in is {factors.enabled ? "on" : "off"}</h2>
        <p className="mt-1 text-muted">
          {factors.enabled
            ? "After signing in, you use a passkey or a code from your app. Making API tokens, approving the CLI and connecting accounts ask again after 15 minutes."
            : "Add a passkey or an authenticator app to turn it on."}
        </p>
      </div>

      {codes && (
        <div className="panel mt-6 border-2 border-ink" role="status" data-no-replay>
          <h2 className="title-3">Your recovery codes</h2>
          <p className="mt-1 text-muted">
            Each one works once, if you lose your phone and passkeys. Keep them somewhere safe, like a password manager.
            This is the only time they’re shown.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-1 font-mono sm:grid-cols-5" aria-label="Recovery codes">
            {codes.map((code) => (
              <li key={code} className="rounded-lg bg-sunk px-2 py-1 text-center">
                {code}
              </li>
            ))}
          </ul>
          <div className="mt-3 w-40">
            <CopyButton value={codes.join("\n")} label="Copy codes" />
          </div>
        </div>
      )}

      <div className="panel mt-6">
        <h2 className="title-3">Passkeys</h2>
        <p className="mt-1 text-muted">
          Your fingerprint, face or device PIN, or a security key. The quickest and safest way: nothing to type, and
          fake sites can’t use them.
        </p>
        {factors.passkeys.length > 0 && (
          <ul className="mt-3 grid gap-2">
            {factors.passkeys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-raised p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{key.name}</p>
                  <p className="text-sm text-muted">
                    Added {when(key.createdAt)}
                    {key.lastUsedAt ? ` · last used ${when(key.lastUsedAt)}` : ""}
                  </p>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="passkey-remove" />
                  <input type="hidden" name="id" value={key.id} />
                  <button type="submit" className="btn btn-quiet btn-sm">
                    Remove
                  </button>
                </Form>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className="input min-h-10 w-56 py-1"
            placeholder="Name, like “MacBook”"
            aria-label="Passkey name"
            maxLength={40}
            value={passkeyName}
            onChange={(event) => setPasskeyName(event.target.value)}
          />
          <button type="button" className="btn btn-ink" onClick={() => void addPasskey()} disabled={adding}>
            {adding ? "Waiting for your device…" : "Add a passkey"}
          </button>
        </div>
        {passkeyError && (
          <p className="mt-2 text-sm text-hot" role="alert">
            {passkeyError}
          </p>
        )}
      </div>

      <div className="panel mt-6">
        <h2 className="title-3">Authenticator app</h2>
        <p className="mt-1 text-muted">Six-digit codes from 1Password, Google Authenticator, Authy or similar.</p>
        {factors.totp ? (
          <Form method="post" className="mt-3 flex flex-wrap items-center gap-3">
            <span className="font-bold text-slop-text">On</span>
            <input type="hidden" name="intent" value="totp-remove" />
            <button type="submit" className="btn btn-quiet btn-sm">
              Remove
            </button>
          </Form>
        ) : actionData?.kind === "totp" && actionData.setup ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-[180px_1fr]" data-no-replay>
            <img
              src={actionData.setup.qr}
              alt="QR code for your authenticator app"
              className="size-44 rounded-xl bg-white p-2"
            />
            <div>
              <p className="text-sm">Scan it with your app, or type this key:</p>
              <code className="mt-1 block rounded-lg bg-sunk p-2 font-mono text-sm break-all" aria-label="Setup key">
                {actionData.setup.secret}
              </code>
              <Form method="post" className="mt-3 grid gap-2" data-no-capture>
                <input type="hidden" name="intent" value="totp-confirm" />
                <label className="grid gap-1 font-bold">
                  The code it shows
                  <input
                    name="code"
                    className="input font-mono tracking-widest"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    maxLength={7}
                  />
                </label>
                <button
                  type="submit"
                  className="btn btn-slop justify-self-start"
                  disabled={navigation.state !== "idle"}
                >
                  Turn it on
                </button>
                {actionData.error && (
                  <p className="text-sm text-hot" role="alert">
                    {actionData.error}
                  </p>
                )}
              </Form>
            </div>
          </div>
        ) : (
          <Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="totp-start" />
            <button type="submit" className="btn btn-ink">
              Set up an authenticator app
            </button>
          </Form>
        )}
      </div>

      {factors.enabled && (
        <div className="panel mt-6">
          <h2 className="title-3">Recovery codes</h2>
          <p className="mt-1 text-muted">
            {factors.recoveryLeft} of 10 left. Making new ones stops the old ones working.
          </p>
          <Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="recovery-new" />
            <button type="submit" className="btn btn-quiet btn-sm">
              Make new recovery codes
            </button>
          </Form>
        </div>
      )}

      <div className="panel mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="title-3">Where you’re signed in</h2>
          {sessions.length > 1 && (
            <Form method="post">
              <input type="hidden" name="intent" value="end-others" />
              <button type="submit" className="btn btn-ink btn-sm">
                Sign out everywhere else
              </button>
            </Form>
          )}
        </div>
        <ul className="mt-3 grid gap-2">
          {sessions.map((session) => (
            <li key={session.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-raised p-3 text-sm">
              <span className="flex-1">
                <strong>{browserName(session.userAgent)}</strong> · since {when(session.startedAt)}
                {session.current && (
                  <span className="ml-2 rounded-full bg-slop/15 px-2 font-bold text-slop-text">This browser</span>
                )}
              </span>
              {!session.current && (
                <Form method="post">
                  <input type="hidden" name="intent" value="end-session" />
                  <input type="hidden" name="id" value={session.id} />
                  <button type="submit" className="btn btn-quiet btn-sm">
                    Sign out
                  </button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      </div>

      {events.length > 0 && (
        <div className="mt-10">
          <h2 className="title-3">Security log</h2>
          <ol className="mt-3 grid gap-1 border-l-2 border-line pl-4 text-sm">
            {events.map((event, index) => (
              <li key={`${event.at}-${index}`}>
                <span className="text-muted tabular-nums">{when(event.at)}</span> · {event.detail}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
