import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { profileCardData, profileCardPath, slopCardPath } from "~/lib/cards";

const query = vi.fn<() => Promise<unknown>>();
const allowAction = vi.fn<() => Promise<boolean>>();
const cardImage = vi.fn<typeof import("~/.server/cards").cardImage>();
const renderCard = vi.fn<typeof import("~/.server/cards").renderCard>();

vi.mock("~/.server/convex", () => ({ convex: { query } }));
vi.mock("~/.server/tokens", () => ({ allowAction, callerAddress: () => "192.0.2.1" }));
vi.mock(import("~/.server/cards"), async (importOriginal) => ({
  ...(await importOriginal()),
  cardImage,
  renderCard,
}));

const { loader: slopLoader } = await import("~/routes/card.slop");
const { loader: profileLoader } = await import("~/routes/card.profile");

const slop = {
  slug: "test",
  name: "Test",
  tagline: "A test slop",
  launchLabel: null,
  number: 1,
  goalDay: 1,
  goalLength: 7,
  upvotes: 1,
  slopOfTheDay: null,
  slopcessfulAt: null,
  screenshots: ["https://media.test/cover.png"],
  nsfw: false,
};
const owner = { username: "maker", displayName: "Maker" };
const profile = { owner, totalShipped: 1, streak: 1, daysWon: 0, progress: null };

beforeEach(() => {
  vi.clearAllMocks();
  query.mockReset();
  allowAction.mockResolvedValue(true);
  cardImage.mockResolvedValue("data:image/png;base64,test");
  renderCard.mockResolvedValue(new Uint8Array([1]));
});

describe.each([
  { kind: "slop", loader: slopLoader, data: { slop, owner }, canonical: slopCardPath(owner.username, slop) },
  { kind: "profile", loader: profileLoader, data: profile, canonical: profileCardPath(profileCardData(profile)) },
])("$kind card requests", ({ kind, loader, data, canonical }) => {
  const target = new URL(canonical, "https://example.test");
  const version = target.search.slice(3);

  const load = (search: string) => {
    const request = new Request(`${target.origin}${target.pathname}${search}`);
    return loader({
      request,
      params: { handle: "@maker", slug: "test" },
      context: new RouterContextProvider(),
      url: new URL(request.url),
      pattern: kind === "slop" ? "/:handle/:slug/card.png" : "/:handle/card.png",
    });
  };

  it.each([
    "",
    "?v=",
    "?v=wrong",
    "?cache=1",
    `${target.search}&cache=1`,
    `?cache=1&v=${version}`,
    `${target.search}&v=${version}`,
    `${target.search}&v=wrong`,
    `?v=wrong&v=${version}`,
    `${target.search}&`,
    `?%76=${version}`,
    `?v=%${version.charCodeAt(0).toString(16)}${version.slice(1)}`,
  ])("redirects %s without fetching media or rendering", async (search) => {
    query.mockResolvedValue(data);
    const response = await load(search);

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(canonical);
    expect(cardImage).not.toHaveBeenCalled();
    expect(renderCard).not.toHaveBeenCalled();
  });

  it("renders the exact canonical query", async () => {
    query.mockResolvedValue(data);
    const response = await load(target.search);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(renderCard).toHaveBeenCalledTimes(1);
    expect(cardImage).toHaveBeenCalledTimes(kind === "slop" ? 1 : 0);
  });

  it("keeps unknown or hidden content a 404", async () => {
    query.mockResolvedValue(null);

    await expect(load(target.search)).rejects.toMatchObject({ status: 404 });
    expect(cardImage).not.toHaveBeenCalled();
    expect(renderCard).not.toHaveBeenCalled();
  });

  it("applies the address ceiling before querying or rendering", async () => {
    allowAction.mockResolvedValue(false);

    await expect(load(target.search)).rejects.toMatchObject({ status: 429 });
    expect(query).not.toHaveBeenCalled();
    expect(cardImage).not.toHaveBeenCalled();
    expect(renderCard).not.toHaveBeenCalled();
  });
});
