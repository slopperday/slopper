import type { Flash } from "~/lib/model";

const TONES = {
  info: "bg-card",
  success: "bg-slop text-slop-ink",
  error: "bg-hot text-white",
} as const;

export function FlashBanner({ flash }: { flash: Flash }) {
  return (
    <div className="mx-auto mt-4 w-full max-w-6xl px-4">
      <p
        role={flash.tone === "error" ? "alert" : "status"}
        className={`rounded-xl border-2 border-ink px-4 py-3 text-sm font-semibold hard-shadow-sm ${TONES[flash.tone]}`}
      >
        {flash.message}
      </p>
    </div>
  );
}
