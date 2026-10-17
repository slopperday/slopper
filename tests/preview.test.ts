import { describe, expect, it } from "vite-plus/test";
import { assertFetchable, fetchPublic, isPublicAddress, parsePageMeta } from "~/.server/preview";

describe("public addresses", () => {
  it("allows the public internet and nothing private, local or reserved", () => {
    for (const address of ["93.184.215.14", "1.1.1.1", "::ffff:93.184.215.14", "2606:4700:4700::1111"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
      "64:ff9b::a00:1",
      "2002:a00:1::",
      "not an address",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("refuses other schemes, ports, credentials and private IP literals before connecting", () => {
    expect(() => assertFetchable(new URL("https://tiltmaze.app/"))).not.toThrow();
    expect(() => assertFetchable(new URL("https://tiltmaze.app:443/"))).not.toThrow();
    expect(() => assertFetchable(new URL("ftp://tiltmaze.app/"))).toThrow("Only web pages");
    expect(() => assertFetchable(new URL("https://tiltmaze.app:8443/"))).toThrow("standard web ports");
    expect(() => assertFetchable(new URL("https://me:secret@tiltmaze.app/"))).toThrow("don't sign in");
    expect(() => assertFetchable(new URL("http://127.0.0.1/"))).toThrow("isn't on the public internet");
    expect(() => assertFetchable(new URL("http://[::1]/"))).toThrow("isn't on the public internet");
    expect(() => assertFetchable(new URL("http://169.254.169.254/latest/meta-data/"))).toThrow(
      "isn't on the public internet",
    );
  });
});

describe("reading a page", () => {
  const editor = new URL("https://www.tiltmaze.app/editor");

  it("prefers Open Graph tags, resolves the image and decodes entities", () => {
    const html = `<!doctype html><html><head>
      <title>Ignored</title>
      <meta content="Level editor &amp; more" property="og:title">
      <meta property='og:description' content='Build a maze,
        share the &#x27;link&#39;.'>
      <meta property="og:site_name" content="TiltMaze">
      <meta property="og:image" content="/img/og.png?v=2">
      <meta property="og:title" content="A later duplicate">
    </head><body><meta property="og:title" content="In the body"></body></html>`;
    expect(parsePageMeta(html, editor)).toEqual({
      title: "Level editor & more",
      description: "Build a maze, share the 'link'.",
      siteName: "TiltMaze",
      imageUrl: new URL("https://www.tiltmaze.app/img/og.png?v=2"),
    });
  });

  it("falls back to Twitter tags, the title and the host", () => {
    const html = `<title> TiltMaze &mdash; tilt </title><meta name="description" content="Tilt to play.">
      <meta property="og:title" content=""><meta name="twitter:title" content=" ">
      <meta name="twitter:image" content="https://cdn.tiltmaze.app/card.jpg">`;
    expect(parsePageMeta(html, editor)).toEqual({
      title: "TiltMaze — tilt",
      description: "Tilt to play.",
      siteName: "tiltmaze.app",
      imageUrl: new URL("https://cdn.tiltmaze.app/card.jpg"),
    });
  });

  it("drops images that aren't web URLs, trims long text and gives up on a page with nothing to say", () => {
    const long = "x".repeat(300);
    const meta = parsePageMeta(
      `<meta property="og:description" content="${long}"><meta property="og:image" content="javascript:alert(1)">`,
      editor,
    );
    expect(meta?.title).toBe("tiltmaze.app");
    expect(meta?.description).toHaveLength(240);
    expect(meta?.description.endsWith("…")).toBe(true);
    expect(meta?.imageUrl).toBeNull();
    expect(parsePageMeta("<html><body>Hello</body></html>", editor)).toBeNull();
  });
});

describe("fetching", () => {
  const limits = { accept: "text/html", maxBytes: 1024, truncate: true };

  it("never reaches this machine, by name or by address", async () => {
    await expect(fetchPublic(new URL("http://127.0.0.1:8080/"), limits)).rejects.toThrow("standard web ports");
    await expect(fetchPublic(new URL("http://127.0.0.1/"), limits)).rejects.toThrow("isn't on the public internet");
    // A name is checked inside the lookup the socket connects with.
    await expect(fetchPublic(new URL("http://localhost/"), limits)).rejects.toThrow("isn't on the public internet");
  });
});
