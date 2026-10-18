import { EVENTS } from "../shared/events";
import type { Properties } from "../shared/properties";

/**
 * Clicks, form submissions and field changes, captured without any code.
 * What's kept about an element is what a person could see or a developer
 * would select it by: its tag, a short selector, its text, its link. Field
 * values never are, and anything inside `[data-no-capture]` is skipped.
 */

type Capture = (name: string, properties: Properties) => void;

const INTERACTIVE =
  "a, button, input, select, textarea, label, summary, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], [data-capture]";
const IGNORED = "[data-no-capture]";
/** Text from these is never captured, and changes to them aren't either. */
const SENSITIVE = "input[type=password], [data-sensitive], [autocomplete^=cc-]";

const TEXT_LENGTH = 200;
const SELECTOR_DEPTH = 4;

/** Three clicks within a second, within this many pixels of each other, are a rage click. */
const RAGE_CLICKS = 3;
const RAGE_WINDOW_MS = 1_000;
const RAGE_DISTANCE = 30;

function segment(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const captureName = element.getAttribute("data-capture");
  if (captureName) return `${tag}[data-capture="${captureName}"]`;
  return element.id ? `${tag}#${element.id}` : tag;
}

/** `main > form > button`: enough to find the element again without every utility class it wears. */
export function selectorOf(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && parts.length < SELECTOR_DEPTH && current.tagName !== "BODY" && current.tagName !== "HTML") {
    parts.unshift(segment(current));
    if (current.id || current.hasAttribute("data-capture")) break;
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function textOf(element: Element): string | null {
  if (element.matches("input, select, textarea") || element.closest(SENSITIVE)) return null;
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_LENGTH);
  return text || null;
}

/** Same-site links keep only their (sanitized) path; others their origin and path. Query strings never. */
function linkOf(element: Element, sanitizePath: (path: string) => string): string | null {
  const href = element.closest("a")?.getAttribute("href");
  if (!href || !URL.canParse(href, location.href)) return null;
  const url = new URL(href, location.href);
  if (url.protocol !== "http:" && url.protocol !== "https:") return url.protocol.replace(":", "");
  return url.origin === location.origin ? sanitizePath(url.pathname) : `${url.origin}${url.pathname}`;
}

/** What autocapture records about an element. */
export function describeElement(element: Element, sanitizePath: (path: string) => string): Properties {
  const properties: Properties = { tag: element.tagName.toLowerCase(), selector: selectorOf(element) };
  const text = textOf(element);
  if (text) properties.text = text;
  const link = linkOf(element, sanitizePath);
  if (link) properties.href = link;
  if (element.id) properties.elementId = element.id;
  const label = element.getAttribute("aria-label");
  if (label) properties.ariaLabel = label.slice(0, TEXT_LENGTH);
  const captureName = element.getAttribute("data-capture");
  if (captureName) properties.captureName = captureName;
  const name = element.getAttribute("name");
  if (name && element.matches("input, select, textarea, button")) properties.name = name;
  const type = element.getAttribute("type");
  if (type && element.matches("input, button")) properties.inputType = type;
  return properties;
}

/** Where on the page a click landed, for heatmaps: page coordinates and the viewport they were seen at. */
function position(event: MouseEvent): Properties {
  return {
    x: Math.round(event.pageX),
    y: Math.round(event.pageY),
    viewportWidth: window.innerWidth,
  };
}

interface Click {
  at: number;
  x: number;
  y: number;
}

/** Starts listening; returns a function that stops. */
export function startAutocapture(capture: Capture, sanitizePath: (path: string) => string): () => void {
  let clicks: Click[] = [];

  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(IGNORED)) return;
    const element = target.closest(INTERACTIVE);
    if (element)
      capture(EVENTS.autocapture, {
        eventType: "click",
        ...describeElement(element, sanitizePath),
        ...position(event),
      });

    const now = Date.now();
    clicks = [...clicks, { at: now, x: event.clientX, y: event.clientY }].filter(
      (click) => now - click.at <= RAGE_WINDOW_MS,
    );
    const near = clicks.filter(
      (click) => Math.hypot(click.x - event.clientX, click.y - event.clientY) <= RAGE_DISTANCE,
    );
    if (near.length >= RAGE_CLICKS) {
      capture(EVENTS.rageclick, { ...describeElement(element ?? target, sanitizePath), ...position(event) });
      clicks = [];
    }
  };

  const onSubmit = (event: SubmitEvent) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form || form.closest(IGNORED)) return;
    const action = form.getAttribute("action");
    const properties: Properties = { eventType: "submit", tag: "form", selector: selectorOf(form) };
    if (action && URL.canParse(action, location.href))
      properties.formAction = sanitizePath(new URL(action, location.href).pathname);
    if (form.method) properties.formMethod = form.method.toLowerCase();
    const submitter = event.submitter;
    if (submitter) {
      const text = textOf(submitter);
      if (text) properties.text = text;
      const intent = submitter.getAttribute("value");
      // Buttons named "intent" say which of a form's actions ran (`intent=delete`); they aren't typed values.
      if (intent && submitter.getAttribute("name") === "intent") properties.intent = intent.slice(0, TEXT_LENGTH);
    }
    capture(EVENTS.autocapture, properties);
  };

  const onChange = (event: Event) => {
    const field = event.target instanceof Element ? event.target : null;
    if (!field?.matches("input, select, textarea") || field.closest(IGNORED) || field.closest(SENSITIVE)) return;
    if (field.matches("input[type=hidden]")) return;
    capture(EVENTS.autocapture, { eventType: "change", ...describeElement(field, sanitizePath) });
  };

  document.addEventListener("click", onClick, { capture: true, passive: true });
  document.addEventListener("submit", onSubmit, { capture: true });
  document.addEventListener("change", onChange, { capture: true, passive: true });
  return () => {
    document.removeEventListener("click", onClick, { capture: true });
    document.removeEventListener("submit", onSubmit, { capture: true });
    document.removeEventListener("change", onChange, { capture: true });
  };
}
