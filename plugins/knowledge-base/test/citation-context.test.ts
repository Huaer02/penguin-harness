import { expect, it } from "vitest";
import { evidenceContext } from "../workbenches/knowledge-base/ui/citation-context.js";

it("uses the cited historical version even when a newer version comes first", () => {
  const result = evidenceContext(
    [
      { versionId: "new", text: "Changed content" },
      { versionId: "old", text: "Before EVIDENCE after" },
    ],
    { versionId: "old", span: [7, 15], text: "EVIDENCE" },
  );
  expect(result).toEqual({
    before: "Before ",
    passage: "EVIDENCE",
    after: " after",
    leading: false,
    trailing: false,
  });
});
it("refuses missing versions, invalid offsets and text mismatches instead of highlighting unrelated text", () => {
  const versions = [{ versionId: "v", text: "Evidence" }];
  for (const hit of [
    { versionId: "missing", span: [0, 8], text: "Evidence" },
    { versionId: "v", span: [-1, 8], text: "Evidence" },
    { versionId: "v", span: [0, 9], text: "Evidence" },
    { versionId: "v", span: [0, 8], text: "Different" },
    { versionId: "v", span: [], text: "Evidence" },
  ])
    expect(evidenceContext(versions, hit)).toBeNull();
});
it("bounds surrounding context while retaining the complete cited passage", () => {
  const text = "a".repeat(1000) + "证据" + "b".repeat(1000);
  const result = evidenceContext([{ versionId: "v", text }], {
    versionId: "v",
    span: [1000, 1002],
    text: "证据",
  });
  expect(result?.before).toHaveLength(600);
  expect(result?.after).toHaveLength(600);
  expect(result).toMatchObject({ passage: "证据", leading: true, trailing: true });
});
