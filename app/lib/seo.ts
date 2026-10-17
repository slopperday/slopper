import type { MetaDescriptor } from "react-router";

const DEFAULT_DESCRIPTION =
  "Too much slop? Not enough yet! Throw slop at the wall every day: set a goal, ship daily with AI, and keep slopping until one is slopcessful.";

export interface SeoOptions {
  title?: string;
  description?: string;
  /** Site-relative image path; defaults to the cover card. */
  image?: string | null;
  path?: string;
  noindex?: boolean;
}

interface MatchLike {
  id: string;
  loaderData?: unknown;
}

/** The public origin, published by the root loader. */
export function originFrom(matches: readonly (MatchLike | undefined)[]): string {
  const root = matches.find((match) => match?.id === "root")?.loaderData as { origin?: string } | undefined;
  return root?.origin ?? "https://slopper.day";
}

export function seo(matches: readonly (MatchLike | undefined)[], options: SeoOptions = {}): MetaDescriptor[] {
  const origin = originFrom(matches);
  const title = options.title ? `${options.title} · Slopper` : "Slopper · Too much slop? Not enough yet!";
  const description = options.description ?? DEFAULT_DESCRIPTION;
  const image = new URL(options.image ?? "/og.png", origin).href;
  const tags: MetaDescriptor[] = [
    { title },
    { name: "description", content: description },
    { property: "og:site_name", content: "Slopper" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: image },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
  if (options.path) {
    const url = new URL(options.path, origin).href;
    tags.push({ tagName: "link", rel: "canonical", href: url }, { property: "og:url", content: url });
  }
  if (options.noindex) tags.push({ name: "robots", content: "noindex" });
  return tags;
}
