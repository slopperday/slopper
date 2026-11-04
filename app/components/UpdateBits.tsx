import { useState } from "react";
import { Form } from "react-router";
import type { PublicUpdateLink } from "@convex/lib/shape";
import { FIELD_OUTCOMES, type FieldOutcome, LINK_KINDS, type UpdateDetails } from "~/lib/model";
import { Icon } from "./Icon";
import { Lightbox } from "./Lightbox";

/** Small pieces of an update: its version, details, images and links. */

export function VersionTag({ version }: { version: string }) {
  return <span className="tag font-mono">{version}</span>;
}

const OUTCOME_STYLES: Record<FieldOutcome, { className: string; icon: "check" | "close" | null }> = {
  worked: { className: "tag-slop", icon: "check" },
  mixed: { className: "", icon: null },
  broke: { className: "tag-hot", icon: "close" },
};

/** The feature's name as a headline, or how a field test went and who tried it. */
export function UpdateDetailsLine({ details }: { details: UpdateDetails }) {
  if (details.kind === "feature") {
    return <p className="mt-1.5 font-display text-[1.5rem] leading-tight font-extrabold">{details.name}</p>;
  }
  const style = OUTCOME_STYLES[details.outcome];
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`tag ${style.className}`}>
        {style.icon && <Icon name={style.icon} className="size-3.5" />}
        {FIELD_OUTCOMES[details.outcome].label}
      </span>
      {details.who && <span className="text-muted">Tried by {details.who}</span>}
    </p>
  );
}

/** An update's images, blurred like the slop's screenshots until revealed. Opened full screen, never linked. */
export function UpdateImages({ images, name, reveal }: { images: readonly string[]; name: string; reveal: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const frame = "relative shrink-0 snap-start overflow-hidden rounded-xl bg-sunk";
  const items = images.map((url, index) => ({ url, alt: `${name} update image ${index + 1}` }));
  return (
    <>
      <div className="scrollbar-none -mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {images.map((url, index) => {
          const image = (
            <img
              src={url}
              alt={`${name} update image ${index + 1}`}
              loading="lazy"
              className={`h-40 w-auto max-w-[75vw] object-contain sm:h-48 ${reveal ? "" : "scale-110 blur-2xl"}`}
            />
          );
          return reveal ? (
            <button
              key={url}
              type="button"
              onClick={() => setOpen(index)}
              aria-label={`Open ${name} update image ${index + 1} full screen`}
              className={`${frame} cursor-zoom-in`}
            >
              {image}
            </button>
          ) : (
            <a key={url} href="?reveal=1" className={frame}>
              {image}
            </a>
          );
        })}
      </div>
      <Lightbox items={items} index={open} onClose={() => setOpen(null)} onIndex={setOpen} />
    </>
  );
}

function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

/**
 * An update's links: a card for those the maker asked for, a plain row for
 * the rest. The owner can take a card off; the link stays.
 */
export function UpdateLinks({
  updateId,
  links,
  isOwner,
  reveal,
}: {
  updateId: string;
  links: readonly PublicUpdateLink[];
  isOwner: boolean;
  reveal: boolean;
}) {
  return (
    <ul className="mt-3 grid max-w-[68ch] gap-2">
      {links.map((link) => (
        <li key={link.url}>
          {link.preview ? (
            <>
              <a
                href={link.url}
                target="_blank"
                rel="noopener"
                className="group grid overflow-hidden rounded-xl bg-sunk sm:grid-cols-[11rem_minmax(0,1fr)]"
              >
                {link.preview.image && (
                  <span className="relative block aspect-[1.91/1] overflow-hidden bg-board sm:aspect-auto">
                    <img
                      src={link.preview.image}
                      alt=""
                      loading="lazy"
                      className={`absolute inset-0 size-full object-cover ${reveal ? "" : "scale-110 blur-2xl"}`}
                    />
                  </span>
                )}
                <span className={`grid content-center gap-0.5 p-4 ${link.preview.image ? "" : "sm:col-span-2"}`}>
                  <span className="flex items-center gap-1 text-sm text-muted">
                    <span className="truncate">{link.preview.siteName}</span>
                    <Icon name="out" className="size-3.5 shrink-0" />
                  </span>
                  <span className="font-bold group-hover:underline">{link.preview.title}</span>
                  {link.preview.description && (
                    <span className="line-clamp-2 text-[0.9375rem] text-muted">{link.preview.description}</span>
                  )}
                </span>
              </a>
              {isOwner && (
                <Form method="post">
                  <input type="hidden" name="intent" value="remove-preview" />
                  <input type="hidden" name="id" value={updateId} />
                  <input type="hidden" name="url" value={link.url} />
                  <button type="submit" className="min-h-11 text-sm text-muted underline hover:text-ink">
                    Remove preview
                  </button>
                </Form>
              )}
            </>
          ) : (
            <a
              href={link.url}
              target="_blank"
              rel="noopener"
              className="group inline-flex min-h-11 max-w-full items-center gap-2"
            >
              <span className="font-bold group-hover:underline">{LINK_KINDS[link.kind].label}</span>
              <span className="flex min-w-0 items-center gap-1 text-sm text-muted">
                <span className="truncate">{hostOf(link.url)}</span>
                <Icon name="out" className="size-4 shrink-0" />
              </span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
