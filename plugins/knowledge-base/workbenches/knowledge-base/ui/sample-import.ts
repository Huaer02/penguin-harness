import type { Api } from "./manage.js";
export const SAMPLE_MARKER = "[knowledge-sample:gdpevo-essential-starter-v1]";
export type SampleLibrary = { id: string; name: string; description?: string; archived?: boolean };
export type SampleItem = { source: string; title: string; text: string; expectedVersion: null };
export type SampleProgress = {
  total: number;
  completed: number;
  imported: number;
  preserved: number;
  failed: number;
};
/** Only explicit UI actions call this. Existing sources, including user edits, are preserved. */
export async function importSample(
  api: Api,
  items: SampleItem[],
  rememberedId: string | null,
  remember: (id: string) => void,
  progress: (value: SampleProgress) => void,
) {
  const { libraries } = await api<{ libraries: SampleLibrary[] }>("");
  const remembered = libraries.find((l) => l.id === rememberedId);
  const marked = libraries.filter((l) => l.description?.includes(SAMPLE_MARKER));
  if (!remembered && marked.length > 1)
    throw new Error(
      "发现多个 GDPEvo 示例库，请先在知识库管理中确认要保留的示例标记。 / Multiple sample libraries found.",
    );
  let library = remembered ?? marked[0];
  if (library?.archived)
    throw new Error("示例库已归档，请先在管理中取消归档。 / Unarchive the sample library first.");
  if (!library) {
    const result = await api<{ library: SampleLibrary }>("", "POST", {
      name: "GDPEvo Essential · 示例",
    });
    library = result.library;
    remember(library.id); // Keep the id before tagging or importing, so interrupted imports can resume.
    await api(`/${library.id}`, "PUT", {
      description: `${SAMPLE_MARKER}\nGDPEvo 六场景公开训练资料示例。12 份文档，仅用于检索与引用体验。`,
    });
  }
  remember(library.id);
  const { sources } = await api<{ sources: { source: string }[] }>(`/${library.id}/sources`);
  const existing = new Set(sources.map((s) => s.source));
  const state: SampleProgress = {
    total: items.length,
    completed: 0,
    imported: 0,
    preserved: 0,
    failed: 0,
  };
  const failures: string[] = [];
  progress({ ...state });
  for (const item of items) {
    if (existing.has(item.source)) state.preserved++;
    else {
      try {
        const result = await api<{ items: { status: string; error?: string }[] }>(
          `/${library.id}/imports`,
          "POST",
          { items: [item] },
        );
        const entry = result.items[0];
        if (!entry || !["published", "skipped"].includes(entry.status))
          throw new Error(entry?.error ?? entry?.status ?? "Missing import result");
        if (entry.status === "published") state.imported++;
        else state.preserved++;
        existing.add(item.source);
      } catch (e) {
        state.failed++;
        failures.push(`${item.title}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    state.completed++;
    progress({ ...state });
  }
  return { libraryId: library.id, ...state, failures };
}
