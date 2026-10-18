import { useRef, useState } from "react";
import { LIMITS } from "~/lib/model";
import { Icon } from "./Icon";

export interface Screenshot {
  id: string;
  url: string;
}

/** Sharp at twice the size the slop page shows a screenshot, even on wide screens. */
const MAX_EDGE = 2400;
/** Lossy qualities to try, best first, until the image fits the upload limit. */
const QUALITIES = [0.92, 0.86, 0.78] as const;

/**
 * Prepares a screenshot in the browser: no bigger than MAX_EDGE, as sharp
 * as fits in LIMITS.mediaBytes. A PNG stays PNG (lossless, so text and UI
 * edges stay crisp) when it fits; anything else, or a PNG too big, becomes
 * WebP (JPEG where the browser can't encode WebP) at the best quality that
 * fits. Re-encoding through a canvas also strips EXIF and every other kind
 * of metadata (GPS, camera, editing history): a canvas holds only pixels,
 * and createImageBitmap applies the EXIF orientation before they're drawn.
 * GIFs go up as they are to keep the animation; they carry no EXIF, though
 * they can hold comment blocks.
 */
async function prepare(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file; // keep the animation
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string, quality?: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const fits = (blob: Blob | null): blob is Blob => blob !== null && blob.size <= LIMITS.mediaBytes;

  if (file.type === "image/png") {
    const png = await encode("image/png");
    if (fits(png)) return png;
  }
  // Safari may not encode WebP: toBlob then hands back a PNG instead.
  const lossy = (await encode("image/webp", QUALITIES[0]))?.type === "image/webp" ? "image/webp" : "image/jpeg";
  for (const quality of QUALITIES) {
    const blob = await encode(lossy, quality);
    if (fits(blob)) return blob;
  }
  throw new Error(`That image is too big even compressed. Try one under ${LIMITS.mediaBytes / 1024 / 1024} MB.`);
}

interface ScreenshotPickerProps {
  initial: readonly Screenshot[];
  max: number;
  /** The form field each media id is sent as. */
  name?: string;
  /** What one image is called: "screenshot" on a slop, "image" on an update. */
  noun?: string;
  /** Whether the first image is the cover and others can be made it. */
  cover?: boolean;
}

export function ScreenshotPicker({
  initial,
  max,
  name = "screenshot",
  noun = "screenshot",
  cover = true,
}: ScreenshotPickerProps) {
  const capitalized = noun[0].toUpperCase() + noun.slice(1);
  const [shots, setShots] = useState<Screenshot[]>([...initial]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: FileList) {
    setError(null);
    setNotice(null);
    const room = max - shots.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) setError(`Up to ${max} ${noun}s.`);
    setPending((count) => count + chosen.length);
    for (const file of chosen) {
      try {
        const body = new FormData();
        body.set("file", await prepare(file), file.name);
        const response = await fetch("/api/media", { method: "POST", body });
        const result = (await response.json()) as { id?: string; url?: string; nsfw?: boolean; error?: string };
        const { id, url } = result;
        if (!response.ok || !id || !url) throw new Error(result.error ?? "Upload failed");
        setShots((current) => [...current, { id, url }]);
        if (result.nsfw) setNotice("That one looks NSFW, so this slop will be blurred.");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Upload failed");
      } finally {
        setPending((count) => count - 1);
      }
    }
    if (input.current) input.current.value = "";
  }

  return (
    <div>
      {shots.map((shot) => (
        <input key={shot.id} type="hidden" name={name} value={shot.id} />
      ))}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shots.map((shot, index) => (
          <figure key={shot.id} className="relative overflow-hidden rounded-xl bg-sunk">
            <img
              src={shot.url}
              alt={`${capitalized} ${index + 1}`}
              className="aspect-[16/10] w-full object-cover object-top"
            />
            {cover && index === 0 && <span className="tag absolute top-2 left-2 bg-ink text-ground">Cover</span>}
            <figcaption className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/55 p-2">
              {cover && index > 0 && (
                <button
                  type="button"
                  className="btn btn-sm min-h-9 bg-raised px-2.5 text-sm"
                  onClick={() => setShots((current) => [shot, ...current.filter((value) => value.id !== shot.id)])}
                >
                  Make cover
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm min-h-9 bg-raised px-2.5"
                onClick={() => setShots((current) => current.filter((value) => value.id !== shot.id))}
                aria-label={`Remove ${noun} ${index + 1}`}
              >
                <Icon name="close" className="size-4" />
              </button>
            </figcaption>
          </figure>
        ))}
        {Array.from({ length: pending }, (_, index) => (
          <div
            key={`pending-${index}`}
            className="grid aspect-[16/10] animate-pulse place-items-center rounded-xl bg-sunk text-sm text-muted"
          >
            uploading…
          </div>
        ))}
        {shots.length + pending < max && (
          <label className="grid aspect-[16/10] cursor-pointer place-items-center rounded-xl border border-dashed border-line-strong text-center font-bold text-muted transition-colors focus-within:border-(--focus) hover:border-ink hover:text-ink">
            <span className="grid justify-items-center gap-1">
              <Icon name="plus" className="size-6" />
              Add {noun}s
            </span>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="sr-only"
              onChange={(event) => {
                const files = event.currentTarget.files;
                if (files?.length) void upload(files);
              }}
            />
          </label>
        )}
      </div>
      {notice && (
        <p className="field-hint" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
