import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export interface LightboxItem {
  url: string;
  /** Names the picture for screen readers and names the dialog. */
  alt: string;
  /** Play it instead of showing it: a video, with its own controls. */
  video?: boolean;
}

/**
 * A picture or a video filling the screen over the page it was clicked on,
 * still the same site: no file address in a new tab. Escape, the close button
 * or the space around it shut it; the arrows walk the rest of a gallery.
 */
export function Lightbox({
  items,
  index,
  onClose,
  onIndex,
}: {
  items: readonly LightboxItem[];
  /** Which item is up; `null` keeps the lightbox shut. */
  index: number | null;
  onClose: () => void;
  /** Walking a gallery with the arrows or the buttons. Omitted for a single picture. */
  onIndex?: (index: number) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<Element | null>(null);
  const item = index === null ? null : (items[index] ?? null);
  const open = item !== null;
  const many = items.length > 1 && onIndex !== undefined;

  /** The next item round the gallery, wrapping at either end. */
  function step(by: number) {
    if (index === null || !onIndex) return;
    onIndex((index + by + items.length) % items.length);
  }

  // Focus into the dialog, keep the page under it still, and hand focus back.
  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement;
    closeButton.current?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (returnTo.current instanceof HTMLElement) returnTo.current.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || index === null) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        if (!many || index === null || !onIndex) return;
        event.preventDefault();
        onIndex((index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length);
        return;
      }
      // Tab stays inside: the gallery is the whole page while it's up.
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>("button, video[controls]")].filter(
        (node) => node.tabIndex >= 0,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, index, many, items.length, onClose, onIndex]);

  if (!open || !item) return null;

  return createPortal(
    <div
      ref={dialog}
      role="dialog"
      aria-modal="true"
      aria-label={item.alt}
      className="lightbox fixed inset-0 z-[60] grid place-items-center bg-black/90 p-4 text-white sm:p-16"
    >
      {/* The space around the picture shuts it, as do Escape and the close button. */}
      <button
        type="button"
        tabIndex={-1}
        onClick={onClose}
        aria-label="Close the full-screen picture"
        className="absolute inset-0 cursor-zoom-out"
      />

      {item.video ? (
        <video
          src={item.url}
          controls
          autoPlay
          playsInline
          aria-label={item.alt}
          className="relative max-h-full max-w-full rounded-xl bg-black"
        />
      ) : (
        <img
          src={item.url}
          alt={item.alt}
          draggable={false}
          className="relative max-h-full max-w-full rounded-xl object-contain"
        />
      )}

      <button
        ref={closeButton}
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-3 right-3 inline-flex size-11 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/25 focus-visible:outline-white"
      >
        <Icon name="close" />
      </button>

      {many && (
        <>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous"
            className="absolute top-1/2 left-2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/25 focus-visible:outline-white sm:left-4"
          >
            <Icon name="left" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next"
            className="absolute top-1/2 right-2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/25 focus-visible:outline-white sm:right-4"
          >
            <Icon name="right" />
          </button>
          <p
            aria-live="polite"
            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-sm font-bold tabular-nums"
          >
            {(index ?? 0) + 1} / {items.length}
          </p>
        </>
      )}
    </div>,
    document.body,
  );
}
