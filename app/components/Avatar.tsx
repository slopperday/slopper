import type { User } from "~/lib/model";

const SIZES = {
  xs: "size-6 text-[0.6rem]",
  sm: "size-8 text-xs",
  md: "size-11 text-sm",
  lg: "size-24 text-3xl",
} as const;

/** Avatar with an initial fallback tinted from the username. */
export function Avatar({
  user,
  size = "sm",
}: {
  user: Pick<User, "username" | "displayName" | "avatarUrl">;
  size?: keyof typeof SIZES;
}) {
  const base = `${SIZES[size]} shrink-0 rounded-full border-2 border-ink object-cover`;
  if (user.avatarUrl) {
    return (
      <img src={user.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className={`${base} bg-wall-deep`} />
    );
  }
  let hue = 0;
  for (let i = 0; i < user.username.length; i++) hue = (hue + user.username.charCodeAt(i)) % 360;
  return (
    <span
      aria-hidden="true"
      className={`${base} inline-flex items-center justify-center font-display`}
      style={{ background: `oklch(0.84 0.13 ${hue})`, color: "#151513" }}
    >
      {(user.displayName || user.username).slice(0, 1).toUpperCase()}
    </span>
  );
}
