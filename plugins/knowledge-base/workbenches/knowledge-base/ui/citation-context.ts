/** Match the preserved version and exact text before offering a highlighted context. */
export function evidenceContext(
  versions: { versionId: string; text: string }[],
  hit: { versionId: string; span: number[]; text: string },
) {
  const version = versions.find((v) => v.versionId === hit.versionId);
  const [start, end] = hit.span;
  if (
    !version ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start! < 0 ||
    end! <= start! ||
    end! > version.text.length ||
    version.text.slice(start, end) !== hit.text
  )
    return null;
  const from = Math.max(0, start! - 600);
  const to = Math.min(version.text.length, end! + 600);
  return {
    before: version.text.slice(from, start),
    passage: hit.text,
    after: version.text.slice(end, to),
    leading: from > 0,
    trailing: to < version.text.length,
  };
}
