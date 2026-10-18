import { describe, expect, it } from "vite-plus/test";
import { parseFeatures, slopFormValues, slopValues, validateSlop, type SlopDraft } from "~/.server/forms";
import { DRAFT_PROMPT, draftProductPage, type DraftSource, pageText, parseDraft } from "~/.server/draft";
import { isPrivateAddress } from "~/.server/network";
import { LIMITS } from "~/lib/model";

const base: SlopDraft = {
  name: "TiltMaze",
  tagline: "Tilt to play",
  category: "games",
  links: [{ kind: "website", url: "https://tiltmaze.app" }],
};

function errorsOf(draft: SlopDraft): Record<string, string> {
  const result = validateSlop({ ...base, ...draft });
  if (result.ok) throw new Error("Expected the draft to fail validation.");
  return result.errors;
}

describe("product page fields in validation", () => {
  it("accepts a slop without the new fields", () => {
    const result = validateSlop(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.demo).toBeNull();
      expect(result.value.features).toEqual([]);
      expect(result.value.audience).toBe("");
    }
  });

  it("parses the video link into a provider and id", () => {
    const result = validateSlop({ ...base, demo: " https://youtu.be/dQw4w9WgXcQ " });
    expect(result.ok && result.value.demo).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ", vertical: false });
  });

  it("reports a video link that isn't YouTube, Loom or Vimeo", () => {
    expect(errorsOf({ demo: "https://example.com/clip.mp4" }).demo).toBe("Link a video on YouTube, Loom or Vimeo.");
    expect(errorsOf({ demo: "javascript:alert(1)" }).demo).toBe("Link a video on YouTube, Loom or Vimeo.");
  });

  it("trims features and drops rows with nothing typed", () => {
    const result = validateSlop({
      ...base,
      features: [
        { title: "  Tilt  ", body: " Roll the ball. " },
        { title: "", body: "" },
        { title: "   ", body: "   " },
        {},
        { title: "Race", body: "" },
      ],
    });
    expect(result.ok && result.value.features).toEqual([
      { title: "Tilt", body: "Roll the ball." },
      { title: "Race", body: "" },
    ]);
  });

  it("asks for a title when a feature only has a body", () => {
    expect(errorsOf({ features: [{ title: "", body: "Roll the ball." }] }).features).toBe(
      "Give each feature a short title.",
    );
  });

  it("limits feature titles, bodies and the number of features", () => {
    expect(errorsOf({ features: [{ title: "x".repeat(LIMITS.featureTitleLength + 1) }] }).features).toBe(
      `Keep feature titles under ${LIMITS.featureTitleLength} characters.`,
    );
    expect(errorsOf({ features: [{ title: "Tilt", body: "x".repeat(LIMITS.featureBodyLength + 1) }] }).features).toBe(
      `Keep each feature to one line, under ${LIMITS.featureBodyLength} characters.`,
    );
    const many = Array.from({ length: LIMITS.features + 1 }, (_, index) => ({ title: `Feature ${index}` }));
    expect(errorsOf({ features: many }).features).toBe(`Up to ${LIMITS.features} features.`);
    expect(validateSlop({ ...base, features: many.slice(0, LIMITS.features) }).ok).toBe(true);
  });

  it("accepts titles and bodies right at their limits", () => {
    const result = parseFeatures([
      { title: "x".repeat(LIMITS.featureTitleLength), body: "y".repeat(LIMITS.featureBodyLength) },
    ]);
    expect(result.error).toBeNull();
  });

  it("limits the audience line", () => {
    expect(errorsOf({ audience: "x".repeat(LIMITS.audienceLength + 1) }).audience).toBe(
      `Keep it under ${LIMITS.audienceLength} characters.`,
    );
    const result = validateSlop({ ...base, audience: `  ${"x".repeat(LIMITS.audienceLength)}  ` });
    expect(result.ok && result.value.audience).toHaveLength(LIMITS.audienceLength);
  });

  it("reports video, feature and audience problems together", () => {
    const errors = errorsOf({ demo: "nope", features: [{ body: "no title" }], audience: "x".repeat(500) });
    expect(Object.keys(errors).sort()).toEqual(["audience", "demo", "features"]);
  });
});

describe("showing the product page fields in the form", () => {
  it("turns a stored video back into the address people paste", () => {
    const values = slopValues({
      name: "TiltMaze",
      tagline: "Tilt to play",
      description: "",
      category: "games",
      links: [],
      madeWith: [],
      demo: { provider: "youtube", id: "dQw4w9WgXcQ", vertical: true },
      features: [{ title: "Tilt", body: "Roll." }],
      audience: "Commuters",
    });
    expect(values.demo).toBe("https://www.youtube.com/shorts/dQw4w9WgXcQ");
    expect(values.features).toEqual([{ title: "Tilt", body: "Roll." }]);
    expect(values.audience).toBe("Commuters");
  });

  it("falls back to empty values for older slops", () => {
    const values = slopValues({ name: "A", tagline: "B", description: "", category: "games", links: [], madeWith: [] });
    expect(values).toMatchObject({ demo: "", features: [], audience: "" });
    expect(
      slopValues({ name: "A", tagline: "B", description: "", category: "games", links: [], madeWith: [], demo: null })
        .demo,
    ).toBe("");
  });

  it("round-trips a stored video through validation", () => {
    const stored = { provider: "loom", id: "0123456789abcdef0123456789abcdef", vertical: false } as const;
    const values = slopValues({
      name: "A",
      tagline: "B",
      description: "",
      category: "games",
      links: [],
      madeWith: [],
      demo: stored,
    });
    const result = validateSlop({ ...base, demo: values.demo });
    expect(result.ok && result.value.demo).toEqual(stored);
  });

  it("echoes typed rows back after a failed submit", () => {
    const form = new FormData();
    form.append("demo", "https://example.com/x");
    form.append("featureTitle", "Tilt");
    form.append("featureBody", "Roll.");
    form.append("featureTitle", "Race");
    form.append("audience", "Everyone");
    expect(slopFormValues(form)).toMatchObject({
      demo: "https://example.com/x",
      features: [
        { title: "Tilt", body: "Roll." },
        { title: "Race", body: "" },
      ],
      audience: "Everyone",
    });
  });
});

describe("reading the model's draft", () => {
  const draft = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      tagline: "Tilt your phone to roll.",
      description: "A small maze game.",
      features: [{ title: "Tilt", body: "Roll the ball." }],
      audience: "Commuters",
      ...overrides,
    });

  it("reads a well-formed draft", () => {
    expect(parseDraft(draft())).toEqual({
      tagline: "Tilt your phone to roll.",
      description: "A small maze game.",
      features: [{ title: "Tilt", body: "Roll the ball." }],
      audience: "Commuters",
    });
  });

  it("clamps every field to the form's limits, ending on a word with an ellipsis", () => {
    const long = "word ".repeat(200);
    const result = parseDraft(
      draft({
        tagline: long,
        description: long.repeat(10),
        audience: long,
        features: [{ title: long, body: long }],
      }),
    );
    expect(result.tagline.length).toBeLessThanOrEqual(LIMITS.taglineLength);
    expect(result.tagline.endsWith("…")).toBe(true);
    expect(result.description.length).toBeLessThanOrEqual(LIMITS.descriptionLength);
    expect(result.audience.length).toBeLessThanOrEqual(LIMITS.audienceLength);
    expect(result.features[0].title.length).toBeLessThanOrEqual(LIMITS.featureTitleLength);
    expect(result.features[0].body.length).toBeLessThanOrEqual(LIMITS.featureBodyLength);
    expect(result.tagline).not.toMatch(/\s…$/);
  });

  it("drops untitled and malformed features, and keeps at most the limit", () => {
    const rows = [
      { title: "", body: "no title" },
      { body: "missing title" },
      "a string",
      null,
      { title: 5, body: "numeric title" },
      ...Array.from({ length: 10 }, (_, index) => ({ title: `Feature ${index}`, body: 7 })),
    ];
    const result = parseDraft(draft({ features: rows }));
    expect(result.features).toHaveLength(LIMITS.features);
    expect(result.features[0]).toEqual({ title: "Feature 0", body: "" });
  });

  it("treats a missing audience as empty", () => {
    expect(parseDraft(draft({ audience: undefined })).audience).toBe("");
  });

  it("throws on anything malformed", () => {
    expect(() => parseDraft(null)).toThrow("empty");
    expect(() => parseDraft("   ")).toThrow("empty");
    expect(() => parseDraft("not json")).toThrow();
    expect(() => parseDraft("null")).toThrow("isn't an object");
    expect(() => parseDraft('"text"')).toThrow("isn't an object");
    expect(() => parseDraft(draft({ tagline: 1 }))).toThrow("missing");
    expect(() => parseDraft(draft({ description: undefined }))).toThrow("missing");
    expect(() => parseDraft(draft({ features: "none" }))).toThrow("missing");
  });
});

describe("private addresses", () => {
  it("flags private, loopback and link-local IPv4 addresses", () => {
    for (const address of [
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "0.0.0.0",
      "100.64.0.1",
      "224.0.0.1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("allows public IPv4 addresses, including those just outside private ranges", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "192.169.0.1", "100.63.0.1"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it("flags private IPv6 addresses and IPv4 mapped into IPv6", () => {
    for (const address of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  // Node's resolver prints mapped addresses dotted, but a literal can be written in hex.
  it("flags IPv4 mapped into IPv6 when written in hex", () => {
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true);
    expect(isPrivateAddress("::ffff:a00:1")).toBe(true);
  });

  it("allows public IPv6 addresses", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("reading a web page", () => {
  it("keeps the title and meta description and drops scripts and styles", () => {
    const html = `<html><head><title>TiltMaze</title>
      <meta name="description" content="Tilt to roll.">
      <style>.a { color: red }</style><script>window.secret = "x"</script></head>
      <body><h1>Roll the ball</h1><noscript>Enable JS</noscript><p>Fast &amp; fun &quot;maze&quot;</p></body></html>`;
    const text = pageText(html);
    expect(text.split("\n").slice(0, 2)).toEqual(["TiltMaze", "Tilt to roll."]);
    expect(text).toContain("Roll the ball");
    expect(text).toContain('Fast & fun "maze"');
    expect(text).not.toContain("secret");
    expect(text).not.toContain("color: red");
    expect(text).not.toContain("Enable JS");
    expect(text).not.toContain("<");
  });

  it("is empty for an empty page and capped for a huge one", () => {
    expect(pageText("")).toBe("");
    expect(pageText(`<body>${"word ".repeat(10_000)}</body>`).length).toBeLessThanOrEqual(6_000);
  });
});

describe("page text edge cases", () => {
  it("decodes each entity only once", () => {
    expect(pageText("<body>1 &amp;lt; 2</body>")).toBe("1 &lt; 2");
  });

  it("reads a meta description written with content first", () => {
    expect(pageText('<head><meta content="Tilt to roll." name="description"></head><body></body>')).toContain(
      "Tilt to roll.",
    );
  });
});

describe("drafting a product page", () => {
  const settings = {
    apiKey: "key",
    baseUrl: "https://openrouter.test/api/v1/",
    model: "deepseek/deepseek-v4.1-flash",
    provider: "deepseek",
  };
  const source: DraftSource = {
    name: "TiltMaze",
    tagline: "Tilt to play",
    description: "A maze.",
    links: ["https://tiltmaze.app/"],
    madeWith: ["flutter"],
    features: [],
    audience: "",
  };
  const reply = {
    choices: [
      {
        message: {
          content: JSON.stringify({
            tagline: "Roll a ball by tilting your phone.",
            description: "A maze you play by tilting.",
            features: [{ title: "Tilt", body: "Roll the ball." }],
            audience: "Commuters",
          }),
        },
      },
    ],
  };

  function fakeFetch(body: unknown, status = 200) {
    const calls: { url: string; body: string; authorization: string | null }[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push({
        url: input instanceof Request ? input.url : input.toString(),
        body: typeof init?.body === "string" ? init.body : "",
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    };
    return { calls, fetcher };
  }

  it("asks for a JSON object with the system prompt first, then the source material", async () => {
    const { calls, fetcher } = fakeFetch(reply);
    const result = await draftProductPage(source, "TiltMaze\nTilt to roll.", settings, fetcher);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://openrouter.test/api/v1/chat/completions");
    expect(calls[0].authorization).toBe("Bearer key");
    const body = JSON.parse(calls[0].body) as {
      model: string;
      messages: { role: string; content: string }[];
      response_format: unknown;
    };
    expect(body.model).toBe(settings.model);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]).toEqual({ role: "system", content: DRAFT_PROMPT });
    expect(JSON.parse(body.messages[1].content)).toEqual({ ...source, website: "TiltMaze\nTilt to roll." });
    expect(result).toEqual({
      tagline: "Roll a ball by tilting your phone.",
      description: "A maze you play by tilting.",
      features: [{ title: "Tilt", body: "Roll the ball." }],
      audience: "Commuters",
    });
  });

  it("leaves the website out when it couldn't be read", async () => {
    const { calls, fetcher } = fakeFetch(reply);
    await draftProductPage(source, null, settings, fetcher);
    const body = JSON.parse(calls[0].body) as { messages: { content: string }[] };
    expect(JSON.parse(body.messages[1].content)).not.toHaveProperty("website");
  });

  it("throws when the model answers with an error or an unusable draft", async () => {
    await expect(draftProductPage(source, null, settings, fakeFetch("overloaded", 503).fetcher)).rejects.toThrow("503");
    await expect(draftProductPage(source, null, settings, fakeFetch({ choices: [] }).fetcher)).rejects.toThrow("empty");
    await expect(
      draftProductPage(source, null, settings, fakeFetch({ choices: [{ message: { content: "sorry" } }] }).fetcher),
    ).rejects.toThrow();
  });
});
