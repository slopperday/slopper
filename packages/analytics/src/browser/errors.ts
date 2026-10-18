import type { ExceptionSource } from "../shared/errors";

/**
 * Uncaught errors and unhandled promise rejections, as they reach the
 * window. What the page can't act on is left out: errors from browser
 * extensions, cross-origin "Script error."s with nothing in them, and the
 * ResizeObserver loop notice browsers raise for harmless layout feedback.
 */

type Report = (value: unknown, source: ExceptionSource) => void;

const EXTENSION = /^(chrome|moz|safari|safari-web)-extension:/;

export function isNoise(event: Pick<ErrorEvent, "message" | "filename" | "error">): boolean {
  if (EXTENSION.test(event.filename)) return true;
  if (event.message.startsWith("ResizeObserver loop")) return true;
  return event.error === null && event.message === "Script error." && !event.filename;
}

/** Listens for errors; returns a function that stops. */
export function startErrorCapture(report: Report): () => void {
  const onError = (event: ErrorEvent) => {
    if (!isNoise(event)) report(event.error ?? event.message, "uncaught");
  };
  const onRejection = (event: PromiseRejectionEvent) => report(event.reason, "rejection");
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
