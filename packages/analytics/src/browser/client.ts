import { EVENTS, type WireEvent } from "../shared/events";
import { normalizeProperties, type Properties } from "../shared/properties";
import { startAutocapture } from "./autocapture";
import { PageTracker, watchHistory } from "./pageviews";
import { cookieNames, DEFAULT_STORAGE_KEY, ROUTES } from "../shared/routes";
import { readCookie, StateStore, type StoredState, writeCookie } from "./storage";
import { Transport } from "./transport";
import { uuidv7 } from "./uuid";

export interface AnalyticsOptions {
  /**
   * Where events go: the deployment's `.convex.site` URL and the prefix the
   * app mounted the routes at (`Analytics.registerRoutes`), like
   * `https://happy-otter-123.convex.site/a`.
   */
  endpoint: string;
  /** Names the cookies and storage keys. */
  storageKey?: string;
  /** A page view on every history change. Turn off to call `capturePageview` yourself. */
  pageviews?: boolean;
  /** Clicks, form submissions and field changes. */
  autocapture?: boolean;
  /** Minutes without activity that end a session. */
  sessionIdleMinutes?: number;
  /** Sent with every event, like the visitor's country, which the app's server knows and the browser doesn't. */
  properties?: Properties;
  /** Rewrites a path before it leaves the browser: hide ids and tokens in it. */
  sanitizePath?: (path: string) => string;
  batchSize?: number;
  flushIntervalMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

export interface CaptureOptions {
  /** Person properties to set. */
  set?: Properties;
  /** Person properties to set only if they have none yet. */
  setOnce?: Properties;
  /** The page it happened on, when that isn't the current one. */
  path?: string;
}

/** However active, a session ends after a day, so one left-open tab isn't one endless visit. */
const MAX_SESSION_MS = 86_400_000;

/**
 * The browser SDK. Make one per page with `new Analytics(options)` (the
 * React provider does), and it captures page views, page leaves and
 * interactions on its own; `capture` records anything else.
 */
export class Analytics {
  private readonly cookies: ReturnType<typeof cookieNames>;
  private readonly store: StateStore;
  private readonly transport: Transport;
  private readonly pages: PageTracker;
  private readonly sanitizePath: (path: string) => string;
  private readonly idleMs: number;
  private readonly stops: (() => void)[] = [];
  private id: string;
  private stopped = false;

  constructor(private readonly options: AnalyticsOptions) {
    const key = options.storageKey ?? DEFAULT_STORAGE_KEY;
    this.cookies = cookieNames(key);
    this.store = new StateStore(`${key}_state`);
    this.sanitizePath = options.sanitizePath ?? ((path) => path);
    this.idleMs = (options.sessionIdleMinutes ?? 30) * 60_000;
    this.transport = new Transport({
      url: `${options.endpoint.replace(/\/+$/, "")}${ROUTES.events}`,
      batchSize: options.batchSize ?? 20,
      flushIntervalMs: options.flushIntervalMs ?? 3_000,
      maxQueue: 1_000,
      fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    });
    this.pages = new PageTracker(
      // A leave belongs to the session it ended, even one that has since gone quiet.
      (name, properties, path) => this.record(name, properties, { path }, name === EVENTS.pageleave),
      () => this.currentPath(),
    );
    this.id = this.optedOut ? "" : this.loadDistinctId();
    this.start();
  }

  /** Who events are captured as: anonymous until `identify`. Empty while opted out. */
  get distinctId(): string {
    return this.id;
  }

  /** Whether this browser asked not to be tracked (`optOut`). Read fresh, since another tab may have changed it. */
  get optedOut(): boolean {
    return readCookie(this.cookies.optOut) === "1";
  }

  /** Whether `identify` linked this browser to an account. */
  get identified(): boolean {
    return this.store.read().identified;
  }

  private loadDistinctId(): string {
    const existing = readCookie(this.cookies.distinctId);
    if (existing) return existing;
    const id = uuidv7();
    writeCookie(this.cookies.distinctId, id);
    return id;
  }

  private currentPath(): string {
    return this.sanitizePath(location.pathname);
  }

  private update(change: (state: StoredState) => StoredState): StoredState {
    const next = change(this.store.read());
    this.store.write(next);
    return next;
  }

  /** The session for an event at `now`, starting a new one after a quiet spell or a long day. */
  private session(now: number): string {
    const { session } = this.update((state) => {
      const current = state.session;
      const expired =
        !current || now - current.lastActivityAt > this.idleMs || now - current.startedAt > MAX_SESSION_MS;
      return {
        ...state,
        session: expired
          ? { id: uuidv7(now), startedAt: now, lastActivityAt: now }
          : { ...current, lastActivityAt: now },
      };
    });
    return session?.id ?? "";
  }

  /** The current session's id, without counting as activity. */
  get sessionId(): string | null {
    return this.store.read().session?.id ?? null;
  }

  capture(name: string, properties: Properties = {}, options: CaptureOptions = {}): void {
    this.record(name, properties, options, false);
  }

  /** A passive event doesn't count as activity: it neither extends the session nor starts a new one. */
  private record(name: string, properties: Properties, options: CaptureOptions, passive: boolean): void {
    if (this.stopped || this.optedOut) return;
    const now = Date.now();
    const state = this.store.read();
    const sessionId = (passive ? state.session?.id : null) ?? this.session(now);
    const set = options.set ? normalizeProperties(options.set) : null;
    const setOnce = options.setOnce ? normalizeProperties(options.setOnce) : null;
    const event: WireEvent = {
      uuid: uuidv7(now),
      name,
      distinctId: this.id,
      sessionId,
      timestamp: now,
      path: options.path ?? this.currentPath(),
      properties: normalizeProperties({ ...this.options.properties, ...state.superProperties, ...properties }),
      set: set && Object.keys(set).length > 0 ? set : null,
      setOnce: setOnce && Object.keys(setOnce).length > 0 ? setOnce : null,
    };
    this.transport.enqueue(event);
  }

  /** A page view of the current page, for apps that turned automatic page views off. */
  capturePageview(): void {
    this.pages.view();
  }

  /**
   * Links this browser to an account: everything it did before signing in
   * joins the account's history. Call it whenever a signed-in page loads;
   * it only sends something the first time for each account, so `set` is
   * for what's known at sign-in (`setPersonProperties` changes it later).
   */
  identify(distinctId: string, set?: Properties, setOnce?: Properties): void {
    if (this.stopped || this.optedOut || !distinctId) return;
    const previous = this.id;
    if (previous === distinctId && this.identified) return;
    this.id = distinctId;
    writeCookie(this.cookies.distinctId, distinctId);
    this.update((state) => ({ ...state, identified: true }));
    const properties: Properties = previous !== distinctId ? { anonDistinctId: previous } : {};
    this.capture(EVENTS.identify, properties, { set, setOnce });
  }

  /** Sets properties on the current person without another event of note. */
  setPersonProperties(set?: Properties, setOnce?: Properties): void {
    this.capture(EVENTS.identify, {}, { set, setOnce });
  }

  /** Sends `properties` with every later event from this browser. */
  register(properties: Properties): void {
    this.update((state) => ({
      ...state,
      superProperties: { ...state.superProperties, ...normalizeProperties(properties) },
    }));
  }

  unregister(key: string): void {
    this.update((state) => {
      const { [key]: _removed, ...rest } = state.superProperties;
      return { ...state, superProperties: rest };
    });
  }

  /** Signing out: later events are a new anonymous visitor's, in a new session. */
  reset(): void {
    if (this.stopped) return;
    this.store.clear();
    this.id = this.optedOut ? "" : uuidv7();
    if (this.id) writeCookie(this.cookies.distinctId, this.id);
  }

  /**
   * Stops all capturing in this browser, now and on later visits, and
   * forgets its ids. Events still queued are dropped.
   */
  optOut(): void {
    writeCookie(this.cookies.optOut, "1");
    writeCookie(this.cookies.distinctId, null);
    this.store.clear();
    this.transport.stop();
    this.pages.forget();
    this.id = "";
  }

  /** Undoes `optOut`: capturing starts again as a new anonymous visitor. */
  optIn(): void {
    writeCookie(this.cookies.optOut, null);
    this.id = this.loadDistinctId();
    // The page on screen was never recorded while capturing was off.
    this.pages.forget();
    if (this.options.pageviews ?? true) this.pages.view();
  }

  /** Sends everything queued now. */
  async flush(): Promise<void> {
    await this.transport.flush();
  }

  private start(): void {
    if (this.options.autocapture ?? true) {
      this.stops.push(startAutocapture((name, properties) => this.capture(name, properties), this.sanitizePath));
    }
    if (this.options.pageviews ?? true) {
      this.pages.view();
      this.stops.push(watchHistory(() => this.pages.view()));
    }
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        this.pages.scrolled();
      });
    };
    const onPageHide = () => {
      this.pages.scrolled();
      this.pages.leave();
      this.transport.beacon();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // Back from the back-forward cache: the page is showing again.
      if (event.persisted && (this.options.pageviews ?? true)) this.pages.view();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") this.transport.beacon();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    this.stops.push(() => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    });
  }

  /** Stops listening and sends what's queued. For tests and hot reloads; pages never need it. */
  shutdown(): void {
    if (this.stopped) return;
    for (const stop of this.stops.splice(0)) stop();
    this.transport.beacon();
    this.stopped = true;
  }
}
