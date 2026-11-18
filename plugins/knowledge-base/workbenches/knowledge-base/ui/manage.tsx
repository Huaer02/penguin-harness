import { workbenchContext } from "./context.js";
import { useEffect, useState } from "react";
import { Button, Checkbox, Input, Textarea, Modal } from "@prismshadow/penguin-ui";
export type Api = <T>(route: string, method?: string, body?: unknown) => Promise<T>;
type Lib = { id: string; name: string; description?: string; archived?: boolean; shared?: boolean };
type Source = {
  sourceId: string;
  versionId: string;
  source: string;
  title: string;
  enabled: boolean;
  chunkCount: number;
  createdAt: string;
};
type Import = {
  id: string;
  title: string;
  source: string;
  status: string;
  error?: string;
  canRetry: boolean;
  submittedBy: string;
};
type Doc = {
  sourceId: string;
  source: string;
  enabled: boolean;
  versions: {
    versionId: string;
    title: string;
    text: string;
    createdAt: string;
    current: boolean;
    processing?: { chunkCount: number; embedded: boolean };
    chunks: { chunkId: string; text: string; citationUrl: string }[];
  }[];
};
const words = {
  zh: {
    backup: "备份与恢复",
    download: "下载 Project 知识备份",
    restore: "恢复备份",
    restoreFile: "选择备份 JSON",
    restoreHint:
      "恢复要求相同 Project ID 且知识区为空（含建库授权关闭），文件最多 18 MB；不会覆盖已有资料。备份含原文、历史、候选和连接，不含模型密钥。缺失 Agent 的权限会跳过。",
    done: "已完成",
    settings: "知识库设置",
    name: "名称",
    description: "说明",
    save: "保存设置",
    archive: "归档此知识库",
    archiveHint: "归档后 Agent 无法新检索或贡献；连接、资料和历史保留，取消归档可恢复。",
    docs: "资料与版本",
    view: "查看原文与历史",
    enable: "启用",
    disable: "停用",
    enabled: "已启用",
    disabled: "已停用",
    edit: "以此版本更新",
    history: "历史版本",
    current: "当前版本",
    update: "提交资料更新",
    updateHint: "更新保留来源身份，并检查当前版本；过时编辑会被拒绝。",
    batch: "批量导入",
    files: "选择文本文件（最多 50 份）",
    namespace: "来源目录标识",
    namespaceHint:
      "使用不同目录标识区分不同目录的同名文件；同一标识和路径表示同一来源。已有不同正文不会自动覆盖，请从资料列表选择更新。",
    source: "完整来源地址",
    import: "导入所选资料",
    retry: "重试失败项",
    clear: "清空文件选择",
    results: "导入记录与失败反馈",
    submitter: "提交者",
    agentRetry: "请让原提交 Agent 修复来源后重新提交。",
    refresh: "刷新资料",
    pending: "待审核",
    published: "已发布",
    skipped: "未变化",
    failed: "失败",
    accepted: "已接受",
    rejected: "已拒绝",
    text: "正文",
    more: "引用片段",
    format: "仅支持 UTF-8 文本或 Markdown（单文件最多 2 MB）",
    empty: "暂无资料",
    error: "失败",
    badBackup: "备份文件最多 18 MB",
    batchLimit: "单批最多 50 项、800 万字符；请拆分导入。",
  },
  en: {
    backup: "Backup and recovery",
    download: "Download Project knowledge backup",
    restore: "Restore backup",
    restoreFile: "Choose backup JSON",
    restoreHint:
      "Restore requires the same Project ID, no libraries or creation grants, and a file up to 18 MB. Existing documents are never overwritten. Backups include source text, history, candidates and connections, but no model keys. Missing agents are skipped.",
    done: "Completed",
    settings: "Library settings",
    name: "Name",
    description: "Description",
    save: "Save settings",
    archive: "Archive this library",
    archiveHint:
      "Archived libraries reject Agent searches and contributions. Connections and history remain; unarchive to resume use.",
    docs: "Documents and versions",
    view: "Read document and history",
    enable: "Enable",
    disable: "Disable",
    enabled: "Enabled",
    disabled: "Disabled",
    edit: "Update from this version",
    history: "Historical version",
    current: "Current version",
    update: "Publish document update",
    updateHint:
      "Updates keep source identity and check the current version. Stale edits are refused.",
    batch: "Batch import",
    files: "Choose text files (up to 50)",
    namespace: "Source directory identifier",
    namespaceHint:
      "Use separate identifiers for folders containing same-name files. The identifier and relative path identify a source. Changed existing text is never overwritten automatically; choose an explicit document update.",
    source: "Full source address",
    import: "Import selected documents",
    retry: "Retry failed item",
    clear: "Clear selected files",
    results: "Import history and failures",
    submitter: "Submitted by",
    agentRetry: "Ask the original agent to correct the source and resubmit.",
    refresh: "Refresh documents",
    pending: "Pending review",
    published: "Published",
    skipped: "Unchanged",
    failed: "Failed",
    accepted: "Accepted",
    rejected: "Rejected",
    text: "Text",
    more: "Citation chunks",
    format: "Use UTF-8 text or Markdown, at most 2 MB per file",
    empty: "No documents",
    error: "Failed",
    badBackup: "Backup files must be at most 18 MB",
    batchLimit: "Use at most 50 items and 8 million characters per batch. Split larger batches.",
  },
};
export function BackupControls({
  api,
  refresh,
  empty,
  lang,
}: {
  api: Api;
  refresh: () => Promise<void>;
  empty: boolean;
  lang: "zh" | "en";
}) {
  const t = words[lang];
  const [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="kb-stack">
      <h2>{t.backup}</h2>
      <p className="kb-muted">{t.restoreHint}</p>
      <Button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const data = await api<Record<string, unknown>>("/backup");
            const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
            if (blob.size > 18_000_000) throw new Error(t.badBackup);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `knowledge-${String(data.projectId)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          })
        }
      >
        {t.download}
      </Button>
      <Input
        type="file"
        label={t.restoreFile}
        accept=".json"
        disabled={busy || !empty}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <Button
        disabled={busy || !empty || !file}
        onClick={() =>
          void run(async () => {
            if (file!.size > 18_000_000) throw new Error(t.badBackup);
            const result = await api<{
              libraries: number;
              versions: number;
              skippedAgentRows: number;
            }>("/restore", "POST", JSON.parse(await file!.text()));
            await refresh();
            setMessage(`${t.done}: ${JSON.stringify(result)}`);
          })
        }
      >
        {t.restore}
      </Button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
export function LibraryManager({
  view,
  api,
  library,
  refresh,
  lang,
  revision,
}: {
  revision: number;
  view: string;
  api: Api;
  library: Lib;
  refresh: () => Promise<void>;
  lang: "zh" | "en";
}) {
  const [layout, setLayout] = useState("grid");
  const [filter, setFilter] = useState("");

  const [shared, setShared] = useState(!!library.shared);
  const [uploads, setUploads] = useState<File[]>([]);
  const [uploadStates, setUploadStates] = useState<Record<string, string>>({});
  const t = words[lang];
  const root = `/${library.id}`;
  const [name, setName] = useState(library.name),
    [description, setDescription] = useState(library.description ?? ""),
    [archived, setArchived] = useState(!!library.archived);
  const [sources, setSources] = useState<Source[]>([]),
    [imports, setImports] = useState<Import[]>([]),
    [doc, setDoc] = useState<Doc | null>(null),
    [editing, setEditing] = useState(false),
    [body, setBody] = useState("");
  const [namespace, setNamespace] = useState("local"),
    [items, setItems] = useState<
      { source: string; title: string; text: string; error?: string; expectedVersion: null }[]
    >([]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function load() {
    const [s, i] = await Promise.all([
      api<{ sources: Source[] }>(`${root}/sources`),
      api<{ items: Import[] }>(`${root}/imports`),
    ]);
    setSources(s.sources);
    setImports(i.items);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (view !== "documents") {
      setDoc(null);
      setEditing(false);
    }
  }, [view]);
  useEffect(() => {
    void load().catch((e) => setMessage(String(e.message)));
  }, [revision]);
  useEffect(() => {
    setName(library.name);
    setDescription(library.description ?? "");
    setArchived(!!library.archived);
    setShared(!!library.shared);
  }, [library.name, library.description, library.archived, library.shared]);
  async function files(list: FileList) {
    if (list.length > 50) throw new Error(t.batchLimit);
    const next = [];
    for (const f of Array.from(list)) {
      const source = `upload://${encodeURIComponent(namespace || "local")}/${(f.webkitRelativePath || f.name).split("/").map(encodeURIComponent).join("/")}`;
      try {
        if (f.size > 2_000_000 || !/\.(md|markdown|txt|csv|json|log)$/i.test(f.name))
          throw new Error(t.format);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(await f.arrayBuffer());
        next.push({ source, title: f.name, text, expectedVersion: null });
      } catch (e) {
        next.push({
          source,
          title: f.name,
          text: "",
          expectedVersion: null,
          error: String((e as Error).message),
        });
      }
    }
    setItems(next);
  }
  const state = (s: string) => (t as Record<string, string>)[s] ?? s;
  return (
    <>
      <section className="kb-panel-card kb-stack" hidden={view !== "settings"}>
        <h2>{t.settings}</h2>
        <div className="kb-stack">
          <Input
            label={t.name}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
          <Textarea
            label={t.description}
            aria-label={t.description}
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="kb-setting-group">
          <h3>{lang === "zh" ? "共享范围" : "Sharing"}</h3>
          <Checkbox
            checked={shared}
            label={
              lang === "zh"
                ? "项目共享：所有当前和未来 Agent 可读取；写入仍需单独授权"
                : "Project shared: current and future agents can read; writing requires separate access"
            }
            onChange={setShared}
          />
        </div>
        <div className="kb-setting-group">
          <h3>{lang === "zh" ? "归档状态" : "Archive status"}</h3>
          <Checkbox checked={archived} label={t.archive} onChange={setArchived} />
          <p className="kb-muted">{t.archiveHint}</p>
        </div>
        <div className="kb-panel-footer">
          <Button
            disabled={busy || !name.trim()}
            onClick={() =>
              void run(async () => {
                await api(root, "PUT", { name, description, archived, shared });
                await refresh();
                setMessage(t.done);
              })
            }
          >
            {t.save}
          </Button>
        </div>
      </section>
      <section className="kb-browser" hidden={view !== "documents"}>
        <div className="kb-browser-toolbar">
          <h2>
            {lang === "zh" ? "资料" : "Documents"}{" "}
            <span className="kb-muted">{sources.length}</span>
          </h2>
          <div className="kb-row">
            <Input
              aria-label={lang === "zh" ? "搜索资料名称" : "Search documents"}
              placeholder={lang === "zh" ? "搜索资料…" : "Search documents…"}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div
              className="kb-view-switch"
              role="group"
              aria-label={lang === "zh" ? "显示方式" : "View"}
            >
              <Button aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}>
                {lang === "zh" ? "卡片" : "Grid"}
              </Button>
              <Button aria-pressed={layout === "list"} onClick={() => setLayout("list")}>
                {lang === "zh" ? "列表" : "List"}
              </Button>
            </div>
          </div>
        </div>
        {!sources.length && (
          <div className="kb-empty">
            <h3>
              {lang === "zh" ? "把资料放在这里，随时查阅" : "Your documents, ready to explore"}
            </h3>
            <p>
              {lang === "zh"
                ? "从右上角添加 PDF 或文本资料。"
                : "Add PDF or text files from the top right."}
            </p>
          </div>
        )}
        {!!sources.length && (
          <div className={layout === "grid" ? "kb-document-grid" : "kb-document-list"}>
            {sources
              .filter((s) => s.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
              .map((s) => (
                <button
                  type="button"
                  key={s.sourceId}
                  className="kb-document"
                  onClick={() =>
                    void run(async () => {
                      setDoc(await api<Doc>(`${root}/documents/${s.sourceId}`));
                      setEditing(false);
                    })
                  }
                >
                  <span className="kb-document-cover" aria-hidden="true">
                    <svg width="48" height="56" viewBox="0 0 48 56" fill="none">
                      <path
                        d="M10 2h19l13 13v35a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4Z"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        d="M29 2v13h13M14 29h20M14 37h15"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                    <span>{/\.pdf$/i.test(s.title) ? "PDF" : "DOC"}</span>
                  </span>
                  <span className="kb-document-name">{s.title}</span>
                  <time className="kb-document-time" dateTime={s.createdAt}>
                    {new Date(s.createdAt).toLocaleDateString()}
                  </time>
                </button>
              ))}
          </div>
        )}
        {!!sources.length &&
          !sources.some((s) =>
            s.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
          ) && <p>{lang === "zh" ? "没有匹配的资料" : "No matching documents"}</p>}
        {doc && (
          <Modal
            open
            title={doc.versions[0]?.title ?? (lang === "zh" ? "资料详情" : "Document details")}
            closeLabel={lang === "zh" ? "关闭详情" : "Close details"}
            onClose={() => {
              setDoc(null);
              setEditing(false);
            }}
            widthClass="sm:max-w-4xl"
          >
            <div className="kb-detail">
              <div className="kb-document-overview">
                <p className="kb-muted">
                  {doc.enabled
                    ? lang === "zh"
                      ? "可供 Agent 检索"
                      : "Available to agents"
                    : t.disabled}
                </p>
                <h3>{lang === "zh" ? "处理结果" : "Processing"}</h3>
                <dl className="kb-processing">
                  <div>
                    <dt>{lang === "zh" ? "文本与切分" : "Text and chunks"}</dt>
                    <dd>
                      {doc.versions.find((v) => v.current)?.processing?.chunkCount ??
                        doc.versions[0]?.chunks.length}{" "}
                      {lang === "zh" ? "个检索片段" : "retrievable passages"}
                    </dd>
                  </div>
                  <div>
                    <dt>{lang === "zh" ? "检索方式" : "Retrieval"}</dt>
                    <dd>
                      {doc.versions.find((v) => v.current)?.processing?.embedded
                        ? lang === "zh"
                          ? "关键词与向量"
                          : "Keywords and vectors"
                        : lang === "zh"
                          ? "关键词索引"
                          : "Keyword index"}
                    </dd>
                  </div>
                  <div>
                    <dt>{lang === "zh" ? "模型摘要" : "AI summary"}</dt>
                    <dd>{lang === "zh" ? "未生成" : "Not generated"}</dd>
                  </div>
                  <div>
                    <dt>{lang === "zh" ? "知识图谱" : "Knowledge graph"}</dt>
                    <dd>{lang === "zh" ? "未构建" : "Not built"}</dd>
                  </div>
                </dl>
                <p className="kb-muted">
                  {lang === "zh"
                    ? "此资料当前按文本切分建立检索索引，尚未生成模型摘要或图谱。"
                    : "This document is indexed as text passages; no model summary or graph has been generated."}
                </p>
                <details>
                  <summary>{lang === "zh" ? "来源与文档操作" : "Source and actions"}</summary>
                  <div className="kb-stack">
                    <p>{doc.enabled ? t.enabled : t.disabled}</p>
                    <p>{doc.source}</p>
                    {/^knowledge-file:\/\/[a-f0-9]{64}\//.test(doc.source) && (
                      <a
                        href={`${workbenchContext(location.pathname).projectApi}/knowledge-bases${root}/files/${doc.source.split("/")[2]}`}
                        download
                      >
                        {lang === "zh" ? "下载原文件" : "Download original"}
                      </a>
                    )}
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`${root}/documents/${doc.sourceId}`, "PUT", {
                            enabled: !doc.enabled,
                          });
                          setDoc({ ...doc, enabled: !doc.enabled });
                          await load();
                          await refresh();
                        })
                      }
                    >
                      {doc.enabled ? t.disable : t.enable}
                    </Button>
                  </div>
                </details>
              </div>
              <details className="kb-original">
                <summary>
                  {lang === "zh" ? "查看提取文本与版本" : "Extracted text and versions"}
                </summary>
                {doc.versions.map((v) => (
                  <details key={v.versionId}>
                    <summary>
                      {v.title} · {v.current ? t.current : t.history} · {v.createdAt}
                    </summary>
                    <pre>{v.text}</pre>

                    <details>
                      <summary>{t.more}</summary>
                      {v.chunks.map((c) => (
                        <div key={c.chunkId}>
                          <a href={c.citationUrl} target="_blank" rel="noreferrer">
                            {c.chunkId}
                          </a>
                          <pre>{c.text}</pre>
                        </div>
                      ))}
                    </details>
                    {v.current && (
                      <Button
                        disabled={busy || !!library.archived}
                        onClick={() => {
                          setBody(v.text);
                          setEditing(true);
                        }}
                      >
                        {t.edit}
                      </Button>
                    )}
                  </details>
                ))}
              </details>
              {editing && (
                <>
                  <p>{t.updateHint}</p>
                  <Textarea
                    label={t.text}
                    aria-label={t.text}
                    rows={8}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                  <Button
                    disabled={busy || !body.trim()}
                    onClick={() =>
                      void run(async () => {
                        const v = doc.versions.find((v) => v.current)!;
                        await api(`${root}/sources`, "POST", {
                          source: doc.source,
                          title: v.title,
                          text: body,
                          expectedVersion: v.versionId,
                        });
                        setDoc(await api<Doc>(`${root}/documents/${doc.sourceId}`));
                        setEditing(false);
                        await load();
                        await refresh();
                      })
                    }
                  >
                    {t.update}
                  </Button>
                </>
              )}
              {message && <p role="status">{message}</p>}
            </div>
          </Modal>
        )}
      </section>
      <section className="kb-panel-card kb-stack" hidden={view !== "add"}>
        <h2>{lang === "zh" ? "上传文档" : "Upload documents"}</h2>
        <p className="kb-muted">
          {lang === "zh"
            ? "PDF、文本和 Markdown；单文件最多 25 MB，每批最多 50 份。逐份上传和处理，无需再次审核。"
            : "PDF, text and Markdown. Up to 25 MB per file and 50 files per batch. Files publish after processing."}
        </p>
        <Input
          label={lang === "zh" ? "选择文档" : "Choose documents"}
          aria-label={lang === "zh" ? "选择文档" : "Choose documents"}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.markdown,.csv,.json,.log"
          disabled={busy}
          onChange={(e) => {
            setUploads(Array.from(e.target.files ?? []));
            setUploadStates({});
          }}
        />
        <Button
          variant="primary"
          disabled={busy || !uploads.length || !!library.archived}
          onClick={() =>
            void run(async () => {
              if (uploads.length > 50) throw new Error(t.batchLimit);
              for (const file of uploads) {
                const key = `${file.name}:${file.size}:${file.lastModified}`;
                if (uploadStates[key]?.startsWith("✓")) continue;
                setUploadStates((old) => ({
                  ...old,
                  [key]: lang === "zh" ? "上传与解析中…" : "Uploading and parsing…",
                }));
                try {
                  if (file.size > 25 * 1024 * 1024) throw new Error("单文件最多 25 MB");
                  const projectApi = workbenchContext(location.pathname).projectApi;
                  const response = await fetch(
                    `${projectApi}/knowledge-bases${root}/files?name=${encodeURIComponent(file.name)}`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/octet-stream" },
                      body: file,
                      credentials: "same-origin",
                    },
                  );
                  const result = await response.json();
                  if (!response.ok)
                    throw new Error(result.error?.message ?? `HTTP ${response.status}`);
                  if (result.items[0]?.status === "failed") throw new Error(result.items[0].error);
                  setUploadStates((old) => ({
                    ...old,
                    [key]: `✓ ${state(result.items[0].status)}${result.warning ? ` · ${result.warning}` : ""}`,
                  }));
                } catch (e) {
                  setUploadStates((old) => ({ ...old, [key]: String((e as Error).message) }));
                }
              }
              await load();
              await refresh();
            })
          }
        >
          {lang === "zh" ? "导入文档 / 重试失败项" : "Import / retry failed files"}
        </Button>
        <ul aria-live="polite">
          {uploads.map((f) => (
            <li key={`${f.name}:${f.size}:${f.lastModified}`}>
              {f.name} ·{" "}
              {uploadStates[`${f.name}:${f.size}:${f.lastModified}`] ??
                (lang === "zh" ? "待上传" : "Queued")}
            </li>
          ))}
        </ul>
        <details>
          <summary>
            {lang === "zh" ? "高级：自定义文本来源" : "Advanced: custom text sources"}
          </summary>
          <h2>{t.batch}</h2>
          <Input
            label={t.namespace}
            hint={t.namespaceHint}
            value={namespace}
            disabled={busy || !!items.length}
            onChange={(e) => setNamespace(e.target.value)}
          />
          <Input
            label={t.files}
            key={items.length ? "selected" : "empty"}
            type="file"
            multiple
            disabled={busy || !!library.archived}
            onChange={(e) => {
              if (e.target.files) {
                const selected = e.target.files;
                void run(() => files(selected));
              }
            }}
          />
          {!!items.length && (
            <Button disabled={busy} onClick={() => setItems([])}>
              {t.clear}
            </Button>
          )}
          {items.map((item, index) => (
            <div key={index}>
              <Input
                label={`${item.title} · ${t.source}`}
                value={item.source}
                disabled={busy}
                onChange={(e) =>
                  setItems((old) =>
                    old.map((v, i) => (i === index ? { ...v, source: e.target.value } : v)),
                  )
                }
              />
              {item.error && <p>{item.error}</p>}
            </div>
          ))}
          <Button
            disabled={busy || !items.length || !!library.archived}
            onClick={() =>
              void run(async () => {
                if (JSON.stringify(items).length > 8_000_000) throw new Error(t.batchLimit);
                const result = await api<{ items: { status: string }[] }>(
                  `${root}/imports`,
                  "POST",
                  {
                    items,
                  },
                );
                await load();
                await refresh();
                setMessage(
                  [...new Set(result.items.map((i) => i.status))]
                    .map(
                      (status) =>
                        `${state(status)}: ${result.items.filter((i) => i.status === status).length}`,
                    )
                    .join(" · "),
                );
              })
            }
          >
            {t.import}
          </Button>
        </details>
      </section>
      <section className="kb-panel-card" hidden={view !== "imports"}>
        <h2>{t.results}</h2>
        {!imports.length && (
          <p className="kb-muted">{lang === "zh" ? "暂无导入记录" : "No imports yet"}</p>
        )}
        {imports.map((i) => (
          <article key={i.id}>
            <h3>
              {i.title} · {state(i.status)}
            </h3>
            <details>
              <summary>
                {t.submitter}: {i.submittedBy}
              </summary>
              <small>{i.source}</small>
            </details>
            {i.status === "failed" && !i.canRetry && <p>{t.agentRetry}</p>}
            {i.error && <p>{i.error}</p>}
            {i.status === "failed" && i.canRetry && (
              <Button
                disabled={busy || !!library.archived}
                onClick={() =>
                  void run(async () => {
                    await api(`${root}/imports/${i.id}/retry`, "POST");
                    await load();
                    await refresh();
                  })
                }
              >
                {t.retry}
              </Button>
            )}
          </article>
        ))}
      </section>
      {message && <p role="status">{message}</p>}
    </>
  );
}
