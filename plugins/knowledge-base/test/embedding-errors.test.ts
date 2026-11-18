/** Provider failures must not disclose the configured key in user-visible or persisted errors. */
import { expect, it, vi } from "vitest";
import { embedTexts } from "../mcp/lib/embed.mjs";
it("embedding failures report HTTP status while redacting the service key", async () => {
  const secret = "test-credential-that-must-not-be-saved";
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(`Invalid key: ${secret}`, { status: 401 }));
  try {
    const error = await embedTexts(["source"], {
      url: "https://example.invalid/embeddings",
      key: secret,
      model: "test",
    }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("HTTP 401");
    expect((error as Error).message).not.toContain(secret);
  } finally {
    fetch.mockRestore();
  }
});
