/**
 * Demo videos. A slop links a video on YouTube, Loom or Vimeo, never an
 * upload: those hosts moderate and stream it, and requests to Slopper stay
 * small. Only the provider and the video's id are stored, so the embed URL is
 * always built here and never taken from what someone typed.
 */

export type VideoProvider = "youtube" | "loom" | "vimeo";

export interface DemoVideo {
  provider: VideoProvider;
  id: string;
  /** YouTube Shorts: a phone-shaped frame. */
  vertical: boolean;
}

export const VIDEO_PROVIDER_LABELS: Record<VideoProvider, string> = {
  youtube: "YouTube",
  loom: "Loom",
  vimeo: "Vimeo",
};

/** Where embeds load from, for the content security policy. */
export const VIDEO_FRAME_SOURCES = [
  "https://www.youtube-nocookie.com",
  "https://www.loom.com",
  "https://player.vimeo.com",
] as const;

const YOUTUBE_ID = /^[\w-]{11}$/;
const LOOM_ID = /^[a-f0-9]{32}$/;
const VIMEO_ID = /^\d{1,12}$/;

function stripWww(hostname: string): string {
  return hostname.replace(/^(www\.|m\.)/, "");
}

/** Reads a YouTube, Loom or Vimeo link. Null when it's none of them. */
export function parseVideoUrl(raw: string): DemoVideo | null {
  const value = raw.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = stripWww(url.hostname);
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    const id = parts[0] ?? "";
    return YOUTUBE_ID.test(id) ? { provider: "youtube", id, vertical: false } : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    if (parts[0] === "watch" || parts.length === 0) {
      const id = url.searchParams.get("v") ?? "";
      return YOUTUBE_ID.test(id) ? { provider: "youtube", id, vertical: false } : null;
    }
    if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") {
      const id = parts[1] ?? "";
      return YOUTUBE_ID.test(id) ? { provider: "youtube", id, vertical: parts[0] === "shorts" } : null;
    }
    return null;
  }
  if (host === "loom.com") {
    const id = (parts[0] === "share" || parts[0] === "embed" ? parts[1] : "") ?? "";
    return LOOM_ID.test(id) ? { provider: "loom", id, vertical: false } : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = (host === "player.vimeo.com" ? parts[1] : parts[0]) ?? "";
    return VIMEO_ID.test(id) ? { provider: "vimeo", id, vertical: false } : null;
  }
  return null;
}

/** The address people paste back into the form. */
export function videoPageUrl(video: DemoVideo): string {
  switch (video.provider) {
    case "youtube":
      return video.vertical
        ? `https://www.youtube.com/shorts/${video.id}`
        : `https://www.youtube.com/watch?v=${video.id}`;
    case "loom":
      return `https://www.loom.com/share/${video.id}`;
    case "vimeo":
      return `https://vimeo.com/${video.id}`;
  }
}

/** The player, started by the click that loads it. */
export function videoEmbedUrl(video: DemoVideo): string {
  switch (video.provider) {
    case "youtube":
      return `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0&playsinline=1`;
    case "loom":
      return `https://www.loom.com/embed/${video.id}?autoplay=1&hide_owner=true`;
    case "vimeo":
      return `https://player.vimeo.com/video/${video.id}?autoplay=1&dnt=1`;
  }
}

/** A still to show before the player loads. Only YouTube serves one at a predictable address. */
export function videoPosterUrl(video: DemoVideo): string | null {
  return video.provider === "youtube" ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` : null;
}
