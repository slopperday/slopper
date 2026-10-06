import { Splat } from "./Splat";

/** The mark: one green splat with an ink outline peeking through. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      <Splat seed={20261006} className="absolute inset-0 size-full translate-x-[2px] translate-y-[2px] text-ink" />
      <Splat seed={20261006} className="absolute inset-0 size-full text-slop" />
    </span>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <LogoMark />
      <span className="font-display text-[1.6rem] leading-none tracking-tight">slopper</span>
    </span>
  );
}
