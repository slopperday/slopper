import { useRef, useState } from "react";

export interface Screenshot {
  id: string;
  url: string;
}

const MAX_EDGE = 1600;

/** Downscales in the browser so uploads stay small. */
async function shrink(file: File): Promise<Blob> {
  if (file.type === "image/gif") return file; // keep the animation
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.86));
  const webp = await encode("image/webp");
  if (webp?.type === "image/webp") return webp;
  // Safari may not encode WebP.
  const jpeg = await encode("image/jpeg");
  if (!jpeg) throw new Error("Couldn't encode the image");
  return jpeg;
}

export function ScreenshotPicker({ initial, max }: { initial: readonly Screenshot[]; max: number }) {
  const [shots, setShots] = useState<Screenshot[]>([...initial]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(files: FileList) {
    setError(null);
    const room = max - shots.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) setError(`Up to ${max} screenshots.`);
    setPending((count) => count + chosen.length);
    for (const file of chosen) {
      try {
        const body = new FormData();
        body.set("file", await shrink(file), file.name);
        const response = await fetch("/api/media", { method: "POST", body });
        const result = (await response.json()) as { id?: string; url?: string; error?: string };
        const { id, url } = result;
        if (!response.ok || !id || !url) throw new Error(result.error ?? "Upload failed");
        setShots((current) => [...current, { id, url }]);
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
        <input key={shot.id} type="hidden" name="screenshot" value={shot.id} />
      ))}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {shots.map((shot, index) => (
          <figure key={shot.id} className="relative overflow-hidden rounded-lg border-2 border-ink bg-wall-deep">
            <img
              src={shot.url}
              alt={`Screenshot ${index + 1}`}
              className="aspect-[16/10] w-full object-cover object-top"
            />
            {index === 0 && <span className="chip chip-beta absolute top-2 left-2">Cover</span>}
            <figcaption className="absolute inset-x-0 bottom-0 flex justify-end gap-1 bg-gradient-to-t from-black/60 p-2">
              {index > 0 && (
                <button
                  type="button"
                  className="btn btn-sm min-h-0 px-2 py-1 text-xs"
                  onClick={() => setShots((current) => [shot, ...current.filter((value) => value.id !== shot.id)])}
                >
                  Make cover
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm min-h-0 px-2 py-1 text-xs"
                onClick={() => setShots((current) => current.filter((value) => value.id !== shot.id))}
                aria-label={`Remove screenshot ${index + 1}`}
              >
                ✕
              </button>
            </figcaption>
          </figure>
        ))}
        {Array.from({ length: pending }, (_, index) => (
          <div
            key={`pending-${index}`}
            className="grid aspect-[16/10] animate-pulse place-items-center rounded-lg border-2 border-dashed border-ink/50 font-mono text-xs text-muted"
          >
            uploading…
          </div>
        ))}
        {shots.length + pending < max && (
          <label className="grid aspect-[16/10] cursor-pointer place-items-center rounded-lg border-2 border-dashed border-ink/50 text-center text-sm text-muted transition-colors hover:border-ink hover:bg-card">
            <span>
              <span className="block font-display text-3xl text-slop-deep">+</span>
              Add screenshots
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
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
