import { describe, expect, it } from "vite-plus/test";
import { generateServerKeys, jwksDataUri, parseJwksDataUri } from "../scripts/server-keys.ts";

describe("server keys", () => {
  it("a fresh key set holds only the new public key", async () => {
    const keys = await generateServerKeys();
    expect(parseJwksDataUri(keys.jwks)).toEqual([keys.publicJwk]);
    expect(keys.publicJwk).not.toHaveProperty("d");
  });

  it("adding a key keeps the ones already trusted", async () => {
    const old = await generateServerKeys();
    const next = await generateServerKeys();
    const both = jwksDataUri([...parseJwksDataUri(old.jwks), next.publicJwk]);
    expect(parseJwksDataUri(both)).toEqual([old.publicJwk, next.publicJwk]);
  });
});
