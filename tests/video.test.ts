import { describe, expect, it } from "vite-plus/test";
import { type DemoVideo, parseVideoUrl, videoEmbedUrl, videoPageUrl, videoPosterUrl } from "~/lib/video";

const YOUTUBE_ID = "dQw4w9WgXcQ";
const LOOM_ID = "0123456789abcdef0123456789abcdef";

describe("parsing demo video links", () => {
  it("reads YouTube watch links, with or without the scheme and www", () => {
    const expected: DemoVideo = { provider: "youtube", id: YOUTUBE_ID, vertical: false };
    expect(parseVideoUrl(`https://www.youtube.com/watch?v=${YOUTUBE_ID}`)).toEqual(expected);
    expect(parseVideoUrl(`youtube.com/watch?v=${YOUTUBE_ID}&t=42s`)).toEqual(expected);
    expect(parseVideoUrl(`  https://m.youtube.com/watch?v=${YOUTUBE_ID}  `)).toEqual(expected);
    expect(parseVideoUrl(`https://music.youtube.com/watch?v=${YOUTUBE_ID}`)).toEqual(expected);
  });

  it("reads youtu.be short links", () => {
    expect(parseVideoUrl(`https://youtu.be/${YOUTUBE_ID}?si=abc`)).toEqual({
      provider: "youtube",
      id: YOUTUBE_ID,
      vertical: false,
    });
  });

  it("marks Shorts as vertical and reads embed and live links", () => {
    expect(parseVideoUrl(`https://www.youtube.com/shorts/${YOUTUBE_ID}`)).toEqual({
      provider: "youtube",
      id: YOUTUBE_ID,
      vertical: true,
    });
    expect(parseVideoUrl(`https://www.youtube.com/embed/${YOUTUBE_ID}`)).toEqual({
      provider: "youtube",
      id: YOUTUBE_ID,
      vertical: false,
    });
    expect(parseVideoUrl(`https://www.youtube.com/live/${YOUTUBE_ID}`)?.vertical).toBe(false);
    expect(parseVideoUrl(`https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}`)?.id).toBe(YOUTUBE_ID);
  });

  it("rejects YouTube links without a valid video id", () => {
    expect(parseVideoUrl("https://www.youtube.com/watch")).toBeNull();
    expect(parseVideoUrl("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseVideoUrl(`https://www.youtube.com/watch?v=${YOUTUBE_ID}extra`)).toBeNull();
    expect(parseVideoUrl("https://www.youtube.com/")).toBeNull();
    expect(parseVideoUrl("https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx")).toBeNull();
    expect(parseVideoUrl("https://youtu.be/")).toBeNull();
  });

  it("reads Loom share and embed links with 32 hex character ids", () => {
    const expected: DemoVideo = { provider: "loom", id: LOOM_ID, vertical: false };
    expect(parseVideoUrl(`https://www.loom.com/share/${LOOM_ID}`)).toEqual(expected);
    expect(parseVideoUrl(`https://loom.com/embed/${LOOM_ID}?sid=1`)).toEqual(expected);
  });

  it("rejects Loom links with the wrong id or path", () => {
    expect(parseVideoUrl("https://www.loom.com/share/abc123")).toBeNull();
    expect(parseVideoUrl(`https://www.loom.com/share/${LOOM_ID.toUpperCase()}`)).toBeNull();
    expect(parseVideoUrl(`https://www.loom.com/${LOOM_ID}`)).toBeNull();
    expect(parseVideoUrl(`https://www.loom.com/share/${LOOM_ID}0`)).toBeNull();
  });

  it("reads Vimeo page and player links with numeric ids", () => {
    const expected: DemoVideo = { provider: "vimeo", id: "123456789", vertical: false };
    expect(parseVideoUrl("https://vimeo.com/123456789")).toEqual(expected);
    expect(parseVideoUrl("https://player.vimeo.com/video/123456789?h=abc")).toEqual(expected);
  });

  it("rejects Vimeo links that aren't a numeric video", () => {
    expect(parseVideoUrl("https://vimeo.com/channels/staffpicks")).toBeNull();
    expect(parseVideoUrl("https://vimeo.com/")).toBeNull();
    expect(parseVideoUrl("https://vimeo.com/1234567890123")).toBeNull();
  });

  it("rejects other hosts, look-alike hosts and non-web schemes", () => {
    expect(parseVideoUrl("")).toBeNull();
    expect(parseVideoUrl("   ")).toBeNull();
    expect(parseVideoUrl("not a link")).toBeNull();
    expect(parseVideoUrl(`https://example.com/watch?v=${YOUTUBE_ID}`)).toBeNull();
    expect(parseVideoUrl(`https://youtube.com.evil.test/watch?v=${YOUTUBE_ID}`)).toBeNull();
    expect(parseVideoUrl(`https://evil.test/youtube.com/watch?v=${YOUTUBE_ID}`)).toBeNull();
    expect(parseVideoUrl(`javascript:alert("youtube.com/watch?v=${YOUTUBE_ID}")`)).toBeNull();
    expect(parseVideoUrl(`data:text/html,youtube.com/watch?v=${YOUTUBE_ID}`)).toBeNull();
    expect(parseVideoUrl(`ftp://youtube.com/watch?v=${YOUTUBE_ID}`)).toBeNull();
  });
});

describe("building video addresses", () => {
  const videos: DemoVideo[] = [
    { provider: "youtube", id: YOUTUBE_ID, vertical: false },
    { provider: "youtube", id: YOUTUBE_ID, vertical: true },
    { provider: "loom", id: LOOM_ID, vertical: false },
    { provider: "vimeo", id: "123456789", vertical: false },
  ];

  it("round-trips through the page address people paste back", () => {
    for (const video of videos) expect(parseVideoUrl(videoPageUrl(video))).toEqual(video);
  });

  it("builds page addresses for each provider", () => {
    expect(videoPageUrl(videos[0])).toBe(`https://www.youtube.com/watch?v=${YOUTUBE_ID}`);
    expect(videoPageUrl(videos[1])).toBe(`https://www.youtube.com/shorts/${YOUTUBE_ID}`);
    expect(videoPageUrl(videos[2])).toBe(`https://www.loom.com/share/${LOOM_ID}`);
    expect(videoPageUrl(videos[3])).toBe("https://vimeo.com/123456789");
  });

  it("builds autoplaying embeds on the hosts the content security policy allows", () => {
    expect(videoEmbedUrl(videos[0])).toBe(
      `https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?autoplay=1&rel=0&playsinline=1`,
    );
    expect(videoEmbedUrl(videos[2])).toBe(`https://www.loom.com/embed/${LOOM_ID}?autoplay=1&hide_owner=true`);
    expect(videoEmbedUrl(videos[3])).toBe("https://player.vimeo.com/video/123456789?autoplay=1&dnt=1");
  });

  it("reads its own embed addresses back to the same video", () => {
    for (const video of videos.filter((item) => !item.vertical)) {
      expect(parseVideoUrl(videoEmbedUrl(video))).toEqual(video);
    }
  });

  it("only has a poster for YouTube", () => {
    expect(videoPosterUrl(videos[0])).toBe(`https://i.ytimg.com/vi/${YOUTUBE_ID}/hqdefault.jpg`);
    expect(videoPosterUrl(videos[2])).toBeNull();
    expect(videoPosterUrl(videos[3])).toBeNull();
  });
});
