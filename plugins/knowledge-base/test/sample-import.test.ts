import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { importSample, SAMPLE_MARKER } from "../workbenches/knowledge-base/ui/sample-import.js";
import type { SampleItem } from "../workbenches/knowledge-base/ui/sample-import.js";
import type { Api } from "../workbenches/knowledge-base/ui/manage.js";
const items: SampleItem[] = ["a", "b"].map((source) => ({
  source,
  title: source,
  text: source,
  expectedVersion: null,
}));
function fixture() {
  const libraries: { id: string; name: string; description?: string; archived?: boolean }[] = [];
  const sources = new Map<string, SampleItem[]>();
  const calls: { route: string; method: string }[] = [];
  let failSource = "";
  const api = (async (route: string, method = "GET", body?: any) => {
    calls.push({ route, method });
    if (route === "" && method === "GET") return { libraries };
    if (route === "" && method === "POST") {
      const library = { id: `lib-${libraries.length}`, name: body.name };
      libraries.push(library);
      sources.set(library.id, []);
      return { library };
    }
    const id = route.split("/")[1]!;
    if (method === "PUT") {
      Object.assign(
        libraries.find((l) => l.id === id)!,
        body,
      );
      return {};
    }
    if (route.endsWith("/sources")) return { sources: sources.get(id) ?? [] };
    if (route.endsWith("/imports")) {
      const item = body.items[0];
      if (item.source === failSource)
        return { items: [{ status: "failed", error: "temporary failure" }] };
      sources.get(id)!.push(item);
      return { items: [{ status: "published" }] };
    }
    throw new Error(`Unexpected API ${method} ${route}`);
  }) as Api;
  return {
    api,
    libraries,
    sources,
    calls,
    fail: (source: string) => {
      failSource = source;
    },
  };
}
it("creates a tagged library without granting sharing or agent access", async () => {
  const f = fixture();
  let remembered = "";
  const result = await importSample(
    f.api,
    items,
    null,
    (id) => {
      remembered = id;
    },
    () => {},
  );
  expect(result).toMatchObject({ imported: 2, failed: 0, libraryId: remembered });
  expect(f.libraries[0]?.description).toContain(SAMPLE_MARKER);
  expect(f.calls.some((c) => /connections|permissions/.test(c.route))).toBe(false);
  expect(f.libraries[0]).not.toHaveProperty("shared");
});
it("reuses a renamed sample across sessions and preserves edited source content", async () => {
  const f = fixture();
  const first = await importSample(
    f.api,
    items,
    null,
    () => {},
    () => {},
  );
  f.libraries[0]!.name = "My renamed sample";
  f.sources.get(first.libraryId)![0] = { ...items[0]!, text: "User edits" };
  const result = await importSample(
    f.api,
    items,
    null,
    () => {},
    () => {},
  );
  expect(f.libraries).toHaveLength(1);
  expect(result).toMatchObject({ imported: 0, preserved: 2 });
  expect(f.sources.get(first.libraryId)![0]!.text).toBe("User edits");
});
it("retries only missing documents after partial failure", async () => {
  const f = fixture();
  f.fail("b");
  const first = await importSample(
    f.api,
    items,
    null,
    () => {},
    () => {},
  );
  expect(first).toMatchObject({ imported: 1, failed: 1 });
  f.fail("");
  const next = await importSample(
    f.api,
    items,
    first.libraryId,
    () => {},
    () => {},
  );
  expect(next).toMatchObject({ imported: 1, preserved: 1, failed: 0 });
  expect(f.sources.get(first.libraryId)).toHaveLength(2);
});
it("does not adopt an unrelated library just because its name matches", async () => {
  const f = fixture();
  f.libraries.push({ id: "unrelated", name: "GDPEvo Essential · 示例" });
  const result = await importSample(
    f.api,
    items,
    null,
    () => {},
    () => {},
  );
  expect(result.libraryId).not.toBe("unrelated");
  expect(f.libraries[0]).not.toHaveProperty("description");
});
it("does not silently unarchive a sample or import to ambiguous copies", async () => {
  const f = fixture();
  f.libraries.push({ id: "old", name: "Sample", description: SAMPLE_MARKER, archived: true });
  await expect(
    importSample(
      f.api,
      items,
      null,
      () => {},
      () => {},
    ),
  ).rejects.toThrow(/归档/);
  f.libraries.push({ id: "copy", name: "Copy", description: SAMPLE_MARKER });
  await expect(
    importSample(
      f.api,
      items,
      null,
      () => {},
      () => {},
    ),
  ).rejects.toThrow(/多个/);
  expect(f.calls.every((c) => c.method === "GET")).toBe(true);
});
it("ships twelve fixed-source documents with no held-out tasks or answers", () => {
  const data = JSON.parse(
    readFileSync(
      new URL("../workbenches/knowledge-base/ui/samples/gdpevo/corpus.json", import.meta.url),
      "utf8",
    ),
  );
  expect(data.items).toHaveLength(12);
  expect(new Set(data.items.map((i: SampleItem) => i.source)).size).toBe(12);
  for (const item of data.items) {
    expect(item.source).toContain(data.upstreamCommit);
    expect(item.source).toMatch(/-train\//);
    expect(item.source).toMatch(/README\.md$|train_001\/instruction\.md$/);
    expect(item.text.length).toBeGreaterThan(100);
  }
});
