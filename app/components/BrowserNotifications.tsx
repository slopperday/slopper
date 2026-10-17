import { useEffect, useState } from "react";

/**
 * Turns browser notifications on and off for this browser. It registers
 * the service worker (`/sw.js`), asks for permission, subscribes with the
 * server's VAPID key and hands the subscription to `/api/push`.
 */

type Status = "checking" | "unsupported" | "blocked" | "off" | "on";

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** PushManager wants the VAPID key as bytes; the server gives it as base64url. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
}

async function send(method: "POST" | "DELETE", body: unknown): Promise<void> {
  const response = await fetch("/api/push", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? "Something went wrong. Try again.");
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export function BrowserNotifications({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supported()) return setStatus("unsupported");
    if (Notification.permission === "denied") return setStatus("blocked");
    void currentSubscription().then(async (subscription) => {
      // Resend it: the server forgets browsers whose push service gave up on them.
      if (subscription) await send("POST", subscription.toJSON()).catch(() => {});
      setStatus(subscription ? "on" : "off");
    });
  }, []);

  async function turnOn() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setStatus(permission === "denied" ? "blocked" : "off");
    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(vapidPublicKey),
    });
    await send("POST", subscription.toJSON());
    setStatus("on");
  }

  async function turnOff() {
    const subscription = await currentSubscription();
    if (subscription) {
      await send("DELETE", { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    setStatus("off");
  }

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await (status === "on" ? turnOff() : turnOn());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="notifications" className="mt-16 scroll-mt-24" aria-labelledby="notifications-title">
      <h2 id="notifications-title" className="title-2">
        Browser notifications
      </h2>
      <p className="mt-2 text-muted">
        A ping when someone upvotes or pledges, or your slop wins the day, even with Slopper closed. Turn it on in each
        browser.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-4" aria-live="polite">
        {status === "unsupported" ? (
          <p className="text-[0.9375rem] text-muted">
            This browser can't show them. On iPhone or iPad, add Slopper to your Home Screen (Share, Add to Home Screen)
            and open it from there.
          </p>
        ) : status === "blocked" ? (
          <p className="text-[0.9375rem] text-muted">
            Your browser is blocking notifications from Slopper. Allow them in site settings, then reload.
          </p>
        ) : (
          <>
            <button
              type="button"
              className={`btn btn-sm ${status === "on" ? "btn-quiet" : "btn-ink"}`}
              disabled={status === "checking" || busy}
              onClick={() => void toggle()}
            >
              {status === "on" ? "Turn off" : "Turn on"}
            </button>
            <span className="text-sm text-muted">
              {status === "checking" ? "Checking…" : status === "on" ? "On in this browser" : "Off in this browser"}
            </span>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-[0.9375rem] font-bold text-hot">
          {error}
        </p>
      )}
    </section>
  );
}
