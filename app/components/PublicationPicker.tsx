import { useRef, useState } from "react";
import type { PublicationFormat } from "@convex/lib/media";
import { fileSize } from "~/lib/display";
import { LIMITS } from "~/lib/model";
import { Icon } from "./Icon";

export interface Publication {
  id: string;
  fileName: string;
  format: PublicationFormat;
  size: number;
  url: string;
}

/**
 * One PDF or EPUB the maker wrote: a book, zine, guide or paper. It goes up as it
 * is (no shrinking, unlike screenshots), so a file over the limit is refused
 * here before it's sent. Sent as `publication`, empty when there's none.
 */
export function PublicationPicker({ initial }: { initial: Publication | null }) {
  const [publication, setPublication] = useState<Publication | null>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setError(null);
    setNotice(null);
    if (file.size > LIMITS.publicationBytes) {
      setError(`That file is ${fileSize(file.size)}. Keep it under ${LIMITS.publicationBytes / 1024 / 1024} MB.`);
      return;
    }
    setPending(true);
    try {
      const body = new FormData();
      body.set("kind", "publication");
      body.set("file", file, file.name);
      const response = await fetch("/api/media", { method: "POST", body });
      const result = (await response.json()) as Partial<Publication> & { nsfw?: boolean; error?: string };
      const { id, url, fileName, format, size } = result;
      if (!response.ok || !id || !url || !fileName || !format || size === undefined) {
        throw new Error(result.error ?? "Upload failed");
      }
      setPublication({ id, url, fileName, format, size });
      if (result.nsfw) setNotice("That one looks NSFW, so this slop will be blurred.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <input type="hidden" name="publication" value={publication?.id ?? ""} />
      {publication ? (
        <div className="flex items-center gap-3 rounded-xl bg-sunk p-3">
          <Icon name="page" className="size-8 text-muted" />
          <a href={publication.url} target="_blank" rel="noopener" className="min-w-0 flex-1 hover:underline">
            <span className="block truncate font-bold">{publication.fileName}</span>
            <span className="block text-sm text-muted">
              {publication.format.toUpperCase()} · {fileSize(publication.size)}
            </span>
          </a>
          <button
            type="button"
            className="btn btn-sm min-h-9 bg-raised px-2.5"
            aria-label={`Remove ${publication.fileName}`}
            onClick={() => setPublication(null)}
          >
            <Icon name="close" className="size-4" />
          </button>
        </div>
      ) : pending ? (
        <div className="grid min-h-20 animate-pulse place-items-center rounded-xl bg-sunk text-sm text-muted">
          uploading…
        </div>
      ) : (
        <label className="grid min-h-20 cursor-pointer place-items-center rounded-xl border border-dashed border-line-strong p-3 text-center font-bold text-muted transition-colors focus-within:border-(--focus) hover:border-ink hover:text-ink">
          <span className="flex items-center gap-2">
            <Icon name="page" className="size-6" />
            Upload a PDF or EPUB
          </span>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf,application/epub+zip,.epub"
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
      )}
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
