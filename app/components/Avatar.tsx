const SIZES = {
  xs: "size-6 text-[0.7rem]",
  sm: "size-8 text-sm",
  md: "size-11 text-lg",
  lg: "size-24 text-5xl",
} as const;

/** Avatar with an initial fallback tinted from the username. */
export function Avatar({
  user,
  size = "sm",
}: {
  user: { username: string; displayName: string; avatarUrl: string | null };
  size?: keyof typeof SIZES;
}) {
  const base = `${SIZES[size]} shrink-0 rounded-full object-cover`;
  if (user.avatarUrl) {
    return (
      <img src={user.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className={`${base} bg-sunk`} />
    );
  }
  let hue = 0;
  for (let i = 0; i < user.username.length; i++) hue = (hue + user.username.charCodeAt(i)) % 360;
  return (
    <span
      aria-hidden="true"
      className={`${base} inline-flex items-center justify-center font-display leading-none font-extrabold`}
      style={{ background: `oklch(0.86 0.11 ${hue})`, color: "#161a13" }}
    >
      {(user.displayName || user.username).slice(0, 1).toUpperCase()}
    </span>
  );
}
