import { Form, useNavigation } from "react-router";
import { DEFAULT_SIGNUP_EVENT, INTEGRATIONS, type IntegrationProvider } from "~/lib/integrations";
import { Icon } from "./Icon";
import { useHydrated } from "./Tiles";
import { syncedLabel } from "./Traction";

/**
 * The owner's traction sources for one product: connect, show or hide, and
 * disconnect. Every connection is read-only, and its first sync runs before
 * it's saved, so a refused key never gets stored.
 */

export interface ConnectedSource {
  id: string;
  provider: IntegrationProvider;
  settings: Record<string, string>;
  public: boolean;
  status: "pending" | "ok" | "error";
  error: string | null;
  syncedAt: number | null;
}

function describe(source: ConnectedSource): string {
  switch (source.provider) {
    case "stripe":
      return `Restricted key ending ${source.settings.keyEnding ?? "…"}`;
    case "solana":
      return source.settings.wallet ?? "";
    case "ga4":
      return `Property ${source.settings.propertyId} · signups are “${source.settings.signupEvent}” events`;
    case "posthog":
      return `Project ${source.settings.projectId} on ${new URL(source.settings.host ?? "https://posthog.com").host} · signups are “${source.settings.signupEvent}” events`;
  }
}

function ConnectFields({ provider, serviceAccount }: { provider: IntegrationProvider; serviceAccount: string | null }) {
  switch (provider) {
    case "stripe":
      return (
        <>
          <ol className="grid list-decimal gap-1 pl-5 text-[0.9375rem] text-muted marker:text-faint">
            <li>
              In Stripe, open Developers › API keys and{" "}
              <a className="link" href="https://dashboard.stripe.com/apikeys/create" target="_blank" rel="noopener">
                create a restricted key
              </a>
              .
            </li>
            <li>Give it Read on Balance and Subscriptions. Nothing else.</li>
            <li>Paste it here. It's encrypted before it's stored, and Slopper only ever reads.</li>
          </ol>
          <label className="field-label mt-4" htmlFor="stripe-key">
            Restricted key
          </label>
          <input
            id="stripe-key"
            name="key"
            className="input font-mono text-[0.9375rem]"
            placeholder="rk_live_…"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </>
      );
    case "solana":
      return (
        <>
          <p className="text-[0.9375rem] text-muted">
            The wallet you take payments in. USDC and USDT sent to it count as revenue; money it moves itself doesn't.
            No key: payments on Solana are public already.
          </p>
          <label className="field-label mt-4" htmlFor="solana-wallet">
            Wallet address
          </label>
          <input
            id="solana-wallet"
            name="wallet"
            className="input font-mono text-[0.9375rem]"
            placeholder="9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </>
      );
    case "ga4":
      return (
        <>
          <ol className="grid list-decimal gap-1 pl-5 text-[0.9375rem] text-muted marker:text-faint">
            <li>
              In Google Analytics, open Admin › Property access management and add this email as a <b>Viewer</b>:
              <code className="mt-1 block font-mono text-[0.8125rem] break-all text-ink select-all">
                {serviceAccount}
              </code>
            </li>
            <li>Copy the property id from Admin › Property details (a number, not the G- id).</li>
          </ol>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="ga4-property">
                Property id
              </label>
              <input
                id="ga4-property"
                name="propertyId"
                inputMode="numeric"
                className="input font-mono"
                placeholder="412345678"
                autoComplete="off"
                required
              />
            </div>
            <SignupEventField id="ga4-event" />
          </div>
        </>
      );
    case "posthog":
      return (
        <>
          <p className="text-[0.9375rem] text-muted">
            In PostHog, open Settings › Personal API keys and create one with <b>Query Read</b> for this project.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="posthog-key">
                Personal API key
              </label>
              <input
                id="posthog-key"
                name="key"
                className="input font-mono text-[0.9375rem]"
                placeholder="phx_…"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="posthog-project">
                Project id
              </label>
              <input
                id="posthog-project"
                name="projectId"
                inputMode="numeric"
                className="input font-mono"
                placeholder="12345"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="posthog-region">
                Where it lives
              </label>
              <select id="posthog-region" name="region" className="input" defaultValue="us">
                <option value="us">PostHog Cloud US</option>
                <option value="eu">PostHog Cloud EU</option>
                <option value="self">Self-hosted</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="posthog-host">
                Self-hosted address
              </label>
              <input
                id="posthog-host"
                name="host"
                type="url"
                className="input font-mono text-[0.9375rem]"
                placeholder="https://posthog.example.com"
                autoComplete="off"
              />
            </div>
            <SignupEventField id="posthog-event" />
          </div>
        </>
      );
  }
}

function SignupEventField({ id }: { id: string }) {
  return (
    <div>
      <label className="field-label" htmlFor={id}>
        Signup event
      </label>
      <input
        id={id}
        name="signupEvent"
        className="input font-mono"
        defaultValue={DEFAULT_SIGNUP_EVENT}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

function Connected({ source }: { source: ConnectedSource }) {
  const hydrated = useHydrated();
  const info = INTEGRATIONS[source.provider];
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-bold">
            {info.label}
            {source.status === "error" ? (
              <span className="tag tag-hot">Needs you</span>
            ) : source.status === "pending" ? (
              <span className="tag">Waiting for numbers</span>
            ) : (
              <span className="tag tag-slop">
                <Icon name="check" className="size-3.5" /> Connected
              </span>
            )}
          </p>
          <p className="mt-1 text-sm break-all text-muted">{describe(source)}</p>
          {hydrated && source.syncedAt && <p className="mt-0.5 text-sm text-muted">{syncedLabel(source.syncedAt)}</p>}
          {source.error && <p className="mt-2 text-[0.9375rem] font-bold text-hot">{source.error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Form method="post">
            <input type="hidden" name="intent" value="source-visibility" />
            <input type="hidden" name="id" value={source.id} />
            <input type="hidden" name="public" value={source.public ? "off" : "on"} />
            <button type="submit" className="btn btn-sm">
              <Icon name={source.public ? "eye" : "eyeOff"} className="size-4" />
              {source.public ? "Shown to everyone" : "Only you see it"}
            </button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="disconnect" />
            <input type="hidden" name="id" value={source.id} />
            <button type="submit" className="btn btn-quiet btn-sm hover:text-hot">
              Disconnect
            </button>
          </Form>
        </div>
      </div>
    </li>
  );
}

export function Sources({
  name,
  sources,
  available,
  serviceAccount,
  error,
}: {
  name: string;
  sources: readonly ConnectedSource[];
  available: readonly IntegrationProvider[];
  serviceAccount: string | null;
  /** The provider whose connect form just failed, and why. */
  error: { provider: IntegrationProvider; message: string } | null;
}) {
  const navigation = useNavigation();
  const connecting = navigation.state === "submitting" ? navigation.formData?.get("provider") : null;
  const connected = new Set(sources.map((source) => source.provider));
  const open = available.filter((provider) => !connected.has(provider));
  return (
    <section id="traction" className="mt-20 scroll-mt-24 border-t border-line pt-12" aria-labelledby="sources-title">
      <h2 id="sources-title" className="title-2">
        Traction for {name}
      </h2>
      <p className="mt-3 max-w-[60ch] text-muted">
        Connect where your people and money show up, and the slop page grows a board with the real numbers, labelled
        with where they came from. Read only: Slopper can look, never touch. Every launch of {name} shares them.
      </p>

      {sources.length > 0 && (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {sources.map((source) => (
            <Connected key={source.id} source={source} />
          ))}
        </ul>
      )}

      {open.length > 0 && (
        <>
          <h3 className="caps mt-10 text-muted">Connect a source</h3>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {open.map((provider) => {
              const info = INTEGRATIONS[provider];
              const failed = error?.provider === provider ? error.message : null;
              return (
                <li key={provider}>
                  <details className="group py-1" open={failed !== null}>
                    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block font-bold">{info.label}</span>
                        <span className="block text-sm text-muted">{info.counts}</span>
                      </span>
                      <Icon
                        name="plus"
                        className="size-5 shrink-0 text-muted transition-transform group-open:rotate-45"
                      />
                    </summary>
                    <Form method="post" className="pt-2 pb-5">
                      <input type="hidden" name="intent" value="connect" />
                      <input type="hidden" name="provider" value={provider} />
                      <ConnectFields provider={provider} serviceAccount={serviceAccount} />
                      <label className="mt-4 flex min-h-11 items-center gap-2">
                        <input type="checkbox" name="public" defaultChecked className="size-4" />
                        Show these numbers on the slop page
                      </label>
                      {failed && (
                        <p className="field-error" role="alert">
                          {failed}
                        </p>
                      )}
                      <button type="submit" className="btn btn-ink mt-3" disabled={connecting === provider}>
                        {connecting === provider ? "Checking it works…" : `Connect ${info.label}`}
                      </button>
                    </Form>
                  </details>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
