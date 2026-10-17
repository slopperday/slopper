import type { MetaDescriptor } from "react-router";
import { CARD_SIZE } from "./cards";

const DEFAULT_DESCRIPTION =
  "Too much slop? Not enough yet! Throw slop at the wall every day: set a goal, ship daily with AI, and keep slopping until one is slopcessful.";

export interface SeoImage {
  /** Site-relative or absolute. */
  url: string;
  width: number;
  height: number;
  alt: string;
}

const COVER: SeoImage = {
  url: "/og.png",
  ...CARD_SIZE,
  alt: "Slopper: Too much slop? Not enough yet! A 7 slops in 7 days goal, three days slopped.",
};

export interface SeoOptions {
  title?: string;
  description?: string;
  /** Defaults to the cover card. */
  image?: SeoImage;
  /** A video players can show inline (Open Graph): MP4 or WebM. */
  video?: string | null;
  /** `og:type`, with its own properties (`article:published_time`, `profile:username`). */
  type?: { kind: "website" } | { kind: "article" | "profile"; properties: Record<string, string> };
  /** Label and value pairs Slack and others list under the link (`twitter:label1`, `twitter:data1`). */
  labels?: readonly (readonly [label: string, data: string])[];
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

const VIDEO_TYPES: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm" };

/** A video's MIME type from its URL, or null for one link previews can't play. */
export function videoType(url: string): string | null {
  const extension = new URL(url, "https://slopper.day").pathname.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_TYPES[extension] ?? null;
}

export function seo(matches: readonly (MatchLike | undefined)[], options: SeoOptions = {}): MetaDescriptor[] {
  const origin = originFrom(matches);
  const title = options.title ? `${options.title} · Slopper` : "Slopper · Too much slop? Not enough yet!";
  const description = options.description ?? DEFAULT_DESCRIPTION;
  const image = options.image ?? COVER;
  const imageUrl = new URL(image.url, origin).href;
  const type = options.type ?? { kind: "website" };
  const tags: MetaDescriptor[] = [
    { title },
    { name: "description", content: description },
    { property: "og:site_name", content: "Slopper" },
    { property: "og:type", content: type.kind },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: imageUrl },
    { property: "og:image:secure_url", content: imageUrl },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: String(image.width) },
    { property: "og:image:height", content: String(image.height) },
    { property: "og:image:alt", content: image.alt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: imageUrl },
    { name: "twitter:image:alt", content: image.alt },
  ];
  if (type.kind !== "website") {
    for (const [property, content] of Object.entries(type.properties)) tags.push({ property, content });
  }
  const videoMime = options.video ? videoType(options.video) : null;
  if (options.video && videoMime) {
    const video = new URL(options.video, origin).href;
    tags.push(
      { property: "og:video", content: video },
      { property: "og:video:secure_url", content: video },
      { property: "og:video:type", content: videoMime },
    );
  }
  options.labels?.slice(0, 2).forEach(([label, data], index) => {
    tags.push(
      { name: `twitter:label${index + 1}`, content: label },
      { name: `twitter:data${index + 1}`, content: data },
    );
  });
  if (options.path) {
    const url = new URL(options.path, origin).href;
    tags.push({ tagName: "link", rel: "canonical", href: url }, { property: "og:url", content: url });
  }
  if (options.noindex) tags.push({ name: "robots", content: "noindex" });
  return tags;
}
