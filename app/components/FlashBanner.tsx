import type { Flash } from "~/lib/model";

const TONES = {
  info: "bg-sunk text-ink",
  success: "bg-ink text-ground",
  error: "bg-hot text-hot-ink",
} as const;

export function FlashBanner({ flash }: { flash: Flash }) {
  return (
    <div className="mx-auto mt-4 w-full max-w-6xl px-4">
      <p
        role={flash.tone === "error" ? "alert" : "status"}
        className={`rounded-xl px-4 py-3 font-bold ${TONES[flash.tone]}`}
      >
        {flash.message}
      </p>
    </div>
  );
}
