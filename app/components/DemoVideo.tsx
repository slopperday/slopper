import { useState } from "react";
import {
  type DemoVideo as Video,
  VIDEO_PROVIDER_LABELS,
  videoEmbedUrl,
  videoPageUrl,
  videoPosterUrl,
} from "~/lib/video";
import { Icon } from "./Icon";

/**
 * A slop's demo video. Nothing loads from the video host until someone
 * presses play: the still (or a plain panel) stands in, then the player
 * replaces it and starts. Without JavaScript the button is a link to the video.
 */
export function DemoVideo({ video, name }: { video: Video; name: string }) {
  const [playing, setPlaying] = useState(false);
  const poster = videoPosterUrl(video);
  const label = VIDEO_PROVIDER_LABELS[video.provider];
  const frame = video.vertical ? "aspect-[9/16] max-h-[36rem] mx-auto" : "aspect-video w-full";

  if (playing) {
    return (
      <div className={`overflow-hidden rounded-2xl bg-board ${frame}`}>
        <iframe
          src={videoEmbedUrl(video)}
          title={`${name} demo on ${label}`}
          className="size-full"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }

  return (
    <figure>
      <a
        href={videoPageUrl(video)}
        target="_blank"
        rel="noopener"
        onClick={(event) => {
          event.preventDefault();
          setPlaying(true);
        }}
        className={`group relative grid place-items-center overflow-hidden rounded-2xl bg-board ${frame}`}
        aria-label={`Play the ${name} demo`}
      >
        {poster && (
          <img src={poster} alt="" loading="lazy" className="absolute inset-0 size-full object-cover opacity-90" />
        )}
        <span className="relative grid size-18 place-items-center rounded-full bg-board-ink text-board transition-transform group-hover:scale-105 group-focus-visible:scale-105">
          <Icon name="play" filled className="ml-1 size-8" />
        </span>
        <span className="absolute bottom-3 left-3 rounded-md bg-board px-2 py-1 text-sm font-bold text-board-ink">
          Demo · {label}
        </span>
      </a>
      <figcaption className="mt-2 text-sm text-muted">The {label} player loads when you press play.</figcaption>
    </figure>
  );
}
