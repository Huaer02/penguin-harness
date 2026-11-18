import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  Button,
  Checkbox,
  Input,
  Select,
  Textarea,
  Dropdown,
  Modal,
} from "@prismshadow/penguin-ui";
import { BackupControls, LibraryManager } from "./manage.js";
import { SamplePanel } from "./sample.js";
import { CitationEvidence } from "./citation.js";
import type { EvidenceHit } from "./citation.js";
import { workbenchContext } from "./context.js";

type Library = { id: string; name: string; description?: string; archived?: boolean };
type Agent = { agentId: string; name?: string };
type Connection = { agentId: string; contribute: boolean };
type Source = { versionId: string; source: string; title: string };
type Candidate = {
  kind?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  id: string;
  title: string;
  conclusion: string;
  conditions: string;
  evidence: string[];
  status: string;
  provenance: string[];
};
type Hit = EvidenceHit;
const context = workbenchContext(location.pathname);
const deepLink = new URLSearchParams(location.search);
const base = `${context.projectApi}/knowledge-bases`;
const words = {
  zh: {
    title: "项目知识库",
    creationTitle: "Agent 建库权限",
    creationPermission: "允许所选 Agent 创建知识库",
    creationHint:
      "开启后，此 Agent 可通过对话创建库并连接自身；其他 Agent 的连接和内容审核仍由用户管理。",
    permissionSaved: "建库权限已保存。",
    subtitle: "Project 共享资料与待审知识",
    library: "当前知识库",
    independent: "同名独立库",
    newName: "新知识库名称",
    create: "创建知识库",
    empty: "还没有知识库。先创建一个，或选择 Project 已有的知识库。",
    connections: "Agent 连接",
    agent: "选择 Agent",
    contribute: "允许提交资料和经验",
    connect: "连接",
    disconnect: "断开",
    read: "只读",
    write: "读取与贡献",
    import: "直接导入单份文本",
    file: "选择 Markdown 或文本文件",
    source: "来源地址",
    sourceHint: "选择文件后自动填写；使用相同来源地址可更新资料。",
    docTitle: "资料标题",
    text: "正文",
    save: "导入",
    sources: "已入库资料",
    search: "检索",
    query: "问题或关键词",
    noHits:
      "没有找到相关片段。先在资料列表检查导入与启用状态，再检查检索词；若已有正确命中但回答不符，请核查 Agent 是否读取并引用了该证据。",
    diagnostics: "检索诊断",
    importKind: "资料导入",
    findingKind: "任务经验",
    full: "展开引用",
    evidence: "证据与来源",
    trace: "打开提交会话",
    citation: "引用链接",
    lookup: "按引用片段 ID 查看",
    archived: "已归档",
    historical: "历史或停用资料",
    review: "待审知识",
    pending: "待审核",
    accepted: "已接受",
    rejected: "已拒绝",
    accept: "接受",
    reject: "拒绝",
    noPending: "没有待审核内容。",
    refresh: "刷新",
    saved: "资料已导入。",
    created: "知识库已创建。可在设置中连接需要使用它的 Agent。",
    connected: "连接已保存。",
    disconnected: "连接已撤销。",
    handled: "审核已处理。",
    reading: "正在加载…",
    importHint:
      "通过此页面明确导入的资料直接生效；有直接导入权限的 Agent 可发布原文；自主经验仍需审核。",
    reviewHint: "核查结论、适用条件与证据后处理。未审核内容不会进入检索。",
    conditions: "适用条件",
    currentAgent: "当前 Agent",
    error: "操作失败",
    owner: "当前基础管理功能需要 Project owner 的人类登录。",
    tooLarge: "文件最多支持 2 MB。",
    format: "当前支持 UTF-8 文本与 Markdown，PDF 等格式请先提取文字。",
    mode: "检索模式",
    language: "语言",
    count: "条待审核",
    newSession: "安装插件后新建对话，即可使用知识工具。",
    readonly: "已连接的 Agent 可以读取该库。",
  },
  en: {
    title: "Knowledge Base",
    creationTitle: "Agent library creation",
    creationPermission: "Allow the current agent to create libraries",
    creationHint:
      "Allows this agent to create libraries and connect itself. Other agent connections and content review remain user-managed.",
    permissionSaved: "Creation permission saved.",
    subtitle: "Shared Project documents and reviewed findings",
    library: "Knowledge library",
    independent: "Separate library",
    newName: "New library name",
    create: "Create library",
    empty: "Create a library or select an existing Project library.",
    connections: "Agent connections",
    agent: "Select agent",
    contribute: "Allow contributions (review required)",
    connect: "Connect",
    disconnect: "Disconnect",
    read: "Read only",
    write: "Read and contribute",
    import: "Import a single text document",
    file: "Choose a Markdown or text file",
    source: "Source address",
    sourceHint: "Filled from the file name. Reuse the source address to update a document.",
    docTitle: "Document title",
    text: "Text",
    save: "Import",
    sources: "Indexed sources",
    search: "Search",
    query: "Question or keywords",
    noHits:
      "No passages found. Check import and enabled state, then query terms. If passages are correct but the answer is wrong, inspect how the Agent read and cited them.",
    diagnostics: "Retrieval diagnostics",
    importKind: "Source import",
    findingKind: "Task finding",
    full: "Read citation",
    evidence: "Evidence and provenance",
    trace: "Open submitting Session",
    citation: "Citation link",
    lookup: "Read a citation chunk ID",
    archived: "Archived",
    historical: "Historical or disabled source",
    review: "Review findings",
    pending: "Pending",
    accepted: "Accepted",
    rejected: "Rejected",
    accept: "Accept",
    reject: "Reject",
    noPending: "No pending findings.",
    refresh: "Refresh",
    saved: "Document imported.",
    created: "Library created. Configure agent access in Library management.",
    connected: "Connection saved.",
    disconnected: "Connection revoked.",
    handled: "Review completed.",
    reading: "Loading…",
    importHint: "Explicit human imports publish immediately. Agent contributions await review.",
    reviewHint:
      "Check the finding, conditions and evidence. Pending content is excluded from search.",
    conditions: "Applicable conditions",
    currentAgent: "Current agent",
    error: "Operation failed",
    owner: "Basic management requires a human Project owner sign-in.",
    tooLarge: "Files must be at most 2 MB.",
    format: "Use UTF-8 text or Markdown. Extract binary documents first.",
    mode: "Search mode",
    language: "Language",
    count: "pending",
    newSession: "Open a new conversation after installing the plugin to use knowledge tools.",
    readonly: "Connected agents can read this library.",
  },
};
async function api<T>(route: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(base + route, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(data?.error?.message ?? `HTTP ${response.status}`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
function App() {
  const [lang, setLang] = useState<"zh" | "en">(() => {
    try {
      return localStorage.getItem("penguin.lang") === "en" ? "en" : "zh";
    } catch {
      return "zh";
    }
  });
  const [newOpen, setNewOpen] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [managementTab, setManagementTab] = useState("settings");
  const [addTab, setAddTab] = useState("add");
  const t = words[lang];
  const [view, setView] = useState(deepLink.get("chunk") ? "search" : "documents");
  const [permissionAgent, setPermissionAgent] = useState("");
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [importAllowed, setImportAllowed] = useState(false);
  useEffect(() => {
    if (!permissionAgent) return;
    let active = true;
    setPermissionsLoading(true);
    void Promise.all([
      api<{ allowed: boolean }>(`/creation-permissions/${encodeURIComponent(permissionAgent)}`),
      api<{ allowed: boolean }>(`/import-permissions/${encodeURIComponent(permissionAgent)}`),
    ])
      .then(([c, i]) => {
        if (active) {
          setCreationAllowed(c.allowed);
          setImportAllowed(i.allowed);
        }
      })
      .catch((e) => {
        if (active) setError(String(e.message));
      })
      .finally(() => {
        if (active) setPermissionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [permissionAgent]);
  const [libraries, setLibraries] = useState<Library[]>([]),
    [agents, setAgents] = useState<Agent[]>([]),
    [library, setLibrary] = useState("");
  const [revision, setRevision] = useState(0);
  const [creationAllowed, setCreationAllowed] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]),
    [sources, setSources] = useState<Source[]>([]),
    [candidates, setCandidates] = useState<Candidate[]>([]);
  const [name, setName] = useState(""),
    [agent, setAgent] = useState(context.agentId),
    [contribute, setContribute] = useState(false);
  const [diagnostics, setDiagnostics] = useState("");
  const [chunkLookup, setChunkLookup] = useState("");
  const [source, setSource] = useState(""),
    [title, setTitle] = useState(""),
    [text, setText] = useState(""),
    [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null),
    [mode, setMode] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const selection = useRef(library);
  selection.current = library;
  const generation = useRef(0);
  const pending = candidates.filter((c) => c.status === "pending");
  async function load(selected: string) {
    if (!selected) {
      setConnections([]);
      setSources([]);
      setCandidates([]);
      return;
    }
    const current = ++generation.current;
    const [c, s, r] = await Promise.all([
      api<{ connections: Connection[] }>(`/${selected}/connections`),
      api<{ sources: Source[] }>(`/${selected}/sources`),
      api<{ candidates: Candidate[] }>(`/${selected}/candidates`),
    ]);
    if (current !== generation.current || selection.current !== selected) return;
    setConnections(c.connections);
    setSources(s.sources);
    setCandidates(r.candidates);
    setRevision((v) => v + 1);
  }
  async function refresh(preferred?: string) {
    const data = await api<{ libraries: Library[] }>("");
    setLibraries(data.libraries);
    const wanted = preferred ?? (selection.current || deepLink.get("library") || "");
    if (
      !preferred &&
      !selection.current &&
      deepLink.get("chunk") &&
      deepLink.get("library") &&
      !data.libraries.some((l) => l.id === deepLink.get("library"))
    ) {
      throw new Error(
        lang === "zh"
          ? "此引用的知识库不存在或当前无权访问。"
          : "The cited library is unavailable or you no longer have access.",
      );
    }
    const next = data.libraries.some((l) => l.id === wanted)
      ? wanted
      : (data.libraries[0]?.id ?? "");
    setLibrary(next);
    selection.current = next;
    await load(next);
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void perform(async () => {
      const response = await fetch(`${context.projectApi}/agents`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(t.owner);
      const data = (await response.json()) as { agents: Agent[] };
      setAgents(data.agents);
      await refresh();
    });
  }, []);
  useEffect(() => {
    let active = true;
    selection.current = library;
    setHits(null);
    setMode("");
    void load(library).catch((e) => setError(String(e.message ?? e)));
    if (library && deepLink.get("chunk") && deepLink.get("library") === library)
      void api<Hit>(`/${library}/chunks/${encodeURIComponent(deepLink.get("chunk")!)}`)
        .then((hit) => {
          if (active) setHits([hit]);
        })
        .catch((e) => {
          if (active) setError(String(e.message));
        });
    return () => {
      active = false;
    };
  }, [library]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden && !busy)
        void load(selection.current).catch((e) => setError(String(e.message ?? e)));
    }, 15000);
    return () => clearInterval(timer);
  }, [busy]);
  const submit = (action: () => Promise<void>) => (event: FormEvent) => {
    event.preventDefault();
    void perform(action);
  };
  const agentName = (id: string) => agents.find((a) => a.agentId === id)?.name ?? id;
  async function readFile(file: File) {
    if (file.size > 2_000_000) throw new Error(t.tooLarge);
    if (!/\.(md|markdown|txt|csv|json|log)$/i.test(file.name)) throw new Error(t.format);
    setText(await file.text());
    setTitle(file.name);
    setSource(`upload://${crypto.randomUUID()}/${encodeURIComponent(file.name)}`);
  }
  return (
    <main
      className="kb-page"
      data-view={view === "settings" ? managementTab : view === "add" ? addTab : view}
    >
      <header>
        <div>
          <h1>{t.title}</h1>
          <p className="kb-muted">
            {libraries.find((l) => l.id === library)?.name ??
              (lang === "zh" ? "整理资料，让知识随时可用" : "Keep your knowledge within reach")}
          </p>
        </div>
        <div className="kb-header-actions">
          <Dropdown
            open={newOpen}
            setOpen={setNewOpen}
            button={
              <Button
                variant="primary"
                onClick={() => setNewOpen(!newOpen)}
                aria-expanded={newOpen}
              >
                {lang === "zh" ? "新建" : "New"}
              </Button>
            }
          >
            <div className="kb-menu">
              <Button
                onClick={() => {
                  setView("create");
                  setNewOpen(false);
                }}
              >
                {lang === "zh" ? "新建知识库" : "New library"}
              </Button>
              <Button
                onClick={() => {
                  setView("sample");
                  setNewOpen(false);
                }}
              >
                {lang === "zh" ? "体验 GDPEvo 示例" : "Try GDPEvo sample"}
              </Button>
              <Button
                disabled={!library}
                onClick={() => {
                  setAddTab("add");
                  setView("add");
                  setNewOpen(false);
                }}
              >
                {lang === "zh" ? "添加资料" : "Add documents"}
              </Button>
            </div>
          </Dropdown>
          <Dropdown
            open={managementOpen}
            setOpen={setManagementOpen}
            button={
              <Button
                onClick={() => setManagementOpen(!managementOpen)}
                aria-expanded={managementOpen}
              >
                {lang === "zh" ? "管理" : "Manage"}
              </Button>
            }
          >
            <div className="kb-menu">
              {[
                ["review", `待审核 (${pending.length})`, `Review (${pending.length})`],
                ["settings", "知识库管理", "Library management"],
              ].map(([id, zh, en]) => (
                <Button
                  key={id}
                  onClick={() => {
                    setManagementTab(library ? "settings" : "permissions");
                    setView(id!);
                    setManagementOpen(false);
                  }}
                >
                  {lang === "zh" ? zh : en}
                </Button>
              ))}
            </div>
          </Dropdown>
          <div className="kb-language">
            <Select
              aria-label={t.language}
              value={lang}
              onChange={(e) => setLang(e.target.value as "zh" | "en")}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </Select>
          </div>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      <p role="status">{busy ? t.reading : notice}</p>
      <div className="kb-library-switch">
        <Select
          aria-label={t.library}
          value={library}
          disabled={!libraries.length}
          onChange={(e) => setLibrary(e.target.value)}
        >
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>
      {library ? (
        <LibraryManager
          key={library}
          view="documents"
          revision={revision}
          api={api}
          library={libraries.find((l) => l.id === library)!}
          refresh={() => refresh()}
          lang={lang}
        />
      ) : (
        <div className="kb-empty">
          <h2>{lang === "zh" ? "开始整理你的资料" : "Start your library"}</h2>
          <p>
            {lang === "zh"
              ? "从右上角新建知识库，再添加资料。"
              : "Create a library from the top right, then add documents."}
          </p>
          <Button variant="primary" onClick={() => setView("sample")}>
            {lang === "zh" ? "体验 GDPEvo 示例" : "Try GDPEvo sample"}
          </Button>
        </div>
      )}
      <Modal
        open={view !== "documents"}
        closeLabel={lang === "zh" ? "关闭窗口" : "Close window"}
        title={
          (
            {
              sample: lang === "zh" ? "GDPEvo 示例知识库" : "GDPEvo sample library",
              create: lang === "zh" ? "新建知识库" : "New library",
              add: lang === "zh" ? "添加资料" : "Add documents",
              settings: lang === "zh" ? "知识库管理" : "Library management",
              review: lang === "zh" ? "待审核" : "Review",
              search: lang === "zh" ? "查看引用" : "View citation",
            } as Record<string, string>
          )[view] ?? "Knowledge"
        }
        onClose={() => setView("documents")}
        widthClass={view === "create" ? "sm:max-w-lg" : "sm:max-w-4xl"}
      >
        <div className="kb-action-panel">
          {view === "sample" && (
            <SamplePanel
              api={api}
              lang={lang}
              refresh={refresh}
              openLibrary={() => setView("documents")}
              manageAccess={() => {
                setManagementTab("connections");
                setView("settings");
              }}
            />
          )}
          {error && <p role="alert">{error}</p>}
          {(busy || notice) && <p role="status">{busy ? t.reading : notice}</p>}
          {(view === "settings" || view === "add") && (
            <>
              <div className="kb-panel-context">
                <span className="kb-muted">
                  {view === "settings" && ["permissions", "backup"].includes(managementTab)
                    ? lang === "zh"
                      ? "作用范围：当前项目"
                      : "Scope: current project"
                    : `${t.library}：${libraries.find((l) => l.id === library)?.name ?? "—"}`}
                </span>
              </div>
              <nav className="kb-panel-nav" aria-label={lang === "zh" ? "功能分区" : "Sections"}>
                {(view === "settings"
                  ? [
                      ["settings", "知识库设置", "Library settings"],
                      ["connections", "访问与贡献", "Library access"],
                      ["permissions", "Agent 权限", "Agent permissions"],
                      ["backup", "备份与恢复", "Backup and recovery"],
                    ]
                  : [
                      ["add", "上传文档", "Upload files"],
                      ["manual", "粘贴文本", "Paste text"],
                      ["imports", "导入记录", "Import history"],
                    ]
                ).map(([id, zh, en]) => (
                  <button
                    type="button"
                    key={id}
                    disabled={
                      view === "settings" && !library && ["settings", "connections"].includes(id!)
                    }
                    aria-current={
                      (view === "settings" ? managementTab : addTab) === id ? "page" : undefined
                    }
                    onClick={() => (view === "settings" ? setManagementTab(id!) : setAddTab(id!))}
                  >
                    {lang === "zh" ? zh : en}
                  </button>
                ))}
              </nav>
            </>
          )}
          <div className="kb-panel-card" hidden={view !== "settings" || managementTab !== "backup"}>
            <BackupControls
              api={api}
              refresh={() => refresh()}
              empty={!libraries.length}
              lang={lang}
            />
          </div>
          <section
            className="kb-panel-card kb-stack"
            hidden={view !== "settings" || managementTab !== "permissions"}
          >
            <div>
              <h2>{lang === "zh" ? "Agent 项目权限" : "Agent project permissions"}</h2>
              <p className="kb-muted">
                {lang === "zh"
                  ? "为所选 Agent 设置建库和直接导入权限。单个知识库的读取与贡献权限在“访问与贡献”中管理。"
                  : "Control library creation and direct imports for an agent. Manage access to a specific library under Library access."}
              </p>
            </div>
            <Select
              label={t.agent}
              aria-label={t.agent}
              value={permissionAgent}
              onChange={(e) => setPermissionAgent(e.target.value)}
            >
              <option value="">{lang === "zh" ? "选择要授权的 Agent" : "Choose an agent"}</option>
              {agents.map((a) => (
                <option key={a.agentId} value={a.agentId}>
                  {a.name ?? a.agentId}
                </option>
              ))}
            </Select>
            <Checkbox
              label={
                lang === "zh"
                  ? "允许直接导入原始资料（仍需目标库贡献权限）"
                  : "Publish source imports (requires library contribution access)"
              }
              checked={importAllowed}
              disabled={busy || permissionsLoading || !permissionAgent}
              onChange={(allowed) =>
                void perform(async () => {
                  const result = await api<{ allowed: boolean }>(
                    `/import-permissions/${encodeURIComponent(permissionAgent)}`,
                    "PUT",
                    { allowed },
                  );
                  setImportAllowed(result.allowed);
                })
              }
            />
            <Checkbox
              label={t.creationPermission}
              checked={creationAllowed}
              disabled={busy || permissionsLoading || !permissionAgent}
              onChange={(allowed) => {
                const previous = creationAllowed;
                setCreationAllowed(allowed);
                void perform(async () => {
                  try {
                    const permission = await api<{ allowed: boolean }>(
                      `/creation-permissions/${encodeURIComponent(permissionAgent)}`,
                      "PUT",
                      { allowed },
                    );
                    setCreationAllowed(permission.allowed);
                    setNotice(t.permissionSaved);
                  } catch (error) {
                    setCreationAllowed(previous);
                    throw error;
                  }
                });
              }}
            />
            <p className="kb-muted">{t.creationHint}</p>
          </section>
          <div className="kb-panel-card" hidden={view !== "create"}>
            <p className="kb-muted">
              {lang === "zh"
                ? "先为知识库命名。创建后再添加资料、设置 Agent 访问权限。"
                : "Name your library first. Add documents and configure agent access after creation."}
            </p>
            <form
              className="kb-stack"
              onSubmit={submit(async () => {
                const data = await api<{ library: Library }>("", "POST", { name });
                setName("");
                await refresh(data.library.id);
                setNotice(t.created);
                setView("documents");
              })}
            >
              <Input
                label={t.newName}
                value={name}
                required
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="kb-panel-footer">
                <Button type="button" onClick={() => setView("documents")}>
                  {lang === "zh" ? "取消" : "Cancel"}
                </Button>
                <Button variant="primary" disabled={busy || !name.trim()} type="submit">
                  {t.create}
                </Button>
              </div>
            </form>
          </div>
          {!library ? (
            view !== "create" && view !== "settings" && view !== "sample" && <p>{t.empty}</p>
          ) : (
            <>
              <LibraryManager
                key={library}
                view={view === "settings" ? managementTab : view === "add" ? addTab : view}
                revision={revision}
                api={api}
                library={libraries.find((l) => l.id === library)!}
                refresh={() => refresh()}
                lang={lang}
              />
              <section
                className="kb-panel-card kb-stack"
                hidden={view !== "settings" || managementTab !== "connections"}
              >
                <h2>{t.connections}</h2>
                <p className="kb-muted">{t.readonly}</p>
                <form
                  className="kb-row"
                  onSubmit={submit(async () => {
                    await api(`/${library}/connections/${encodeURIComponent(agent)}`, "PUT", {
                      contribute,
                    });
                    await load(library);
                    setNotice(t.connected);
                  })}
                >
                  <div className="kb-grow">
                    <Select
                      label={t.agent}
                      value={agent}
                      onChange={(e) => setAgent(e.target.value)}
                    >
                      {agents.map((a) => (
                        <option key={a.agentId} value={a.agentId}>
                          {a.name ?? a.agentId}
                          {a.agentId === context.agentId ? ` (${t.currentAgent})` : ""}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Checkbox label={t.contribute} checked={contribute} onChange={setContribute} />
                  <Button type="submit" disabled={busy || !agent}>
                    {t.connect}
                  </Button>
                </form>
                <ul>
                  {connections.map((c) => (
                    <li key={c.agentId}>
                      <span className="kb-grow">
                        {agentName(c.agentId)} · {c.contribute ? t.write : t.read}
                      </span>
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void perform(async () => {
                            await api(
                              `/${library}/connections/${encodeURIComponent(c.agentId)}`,
                              "DELETE",
                            );
                            await load(library);
                            setNotice(t.disconnected);
                          })
                        }
                      >
                        {t.disconnect}
                      </Button>
                    </li>
                  ))}
                </ul>
                <small>{t.newSession}</small>
              </section>
              <section
                className="kb-panel-card kb-stack"
                hidden={view !== "add" || addTab !== "manual"}
              >
                <h2>{t.import}</h2>
                <p className="kb-muted">{t.importHint}</p>
                <form
                  className="kb-stack"
                  onSubmit={submit(async () => {
                    const existing = sources.find((s) => s.source === source);
                    const result = await api<{ items: { status: string; error?: string }[] }>(
                      `/${library}/imports`,
                      "POST",
                      {
                        items: [
                          { source, title, text, expectedVersion: existing?.versionId ?? null },
                        ],
                      },
                    );
                    if (result.items[0]?.status === "failed")
                      throw new Error(result.items[0].error);
                    await load(library);
                    setNotice(t.saved);
                  })}
                >
                  <Input
                    label={t.file}
                    type="file"
                    accept=".md,.markdown,.txt,.csv,.json,.log"
                    disabled={busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void perform(() => readFile(file));
                    }}
                  />
                  <div className="kb-grid">
                    <Input
                      label={t.docTitle}
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                    <Input
                      label={t.source}
                      hint={t.sourceHint}
                      required
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    />
                  </div>
                  <Textarea
                    label={t.text}
                    required
                    value={text}
                    rows={7}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <div>
                    <Button variant="primary" type="submit" disabled={busy || !text.trim()}>
                      {t.save}
                    </Button>
                  </div>
                </form>
                <details>
                  <summary>
                    {t.sources} ({sources.length})
                  </summary>
                  <ul>
                    {sources.map((s) => (
                      <li key={s.versionId}>
                        {s.title}
                        <small>{s.source}</small>
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
              <section hidden={view !== "search"}>
                <details className="kb-citation-tools">
                  <summary>{lang === "zh" ? "查找其他证据" : "Find other evidence"}</summary>
                  <form
                    className="kb-row"
                    onSubmit={submit(async () => {
                      const data = await api<{
                        results: Hit[];
                        modeUsed: string;
                        note?: string;
                        diagnostics: Record<string, unknown>;
                      }>(`/${library}/search`, "POST", { query });
                      setHits(data.results);
                      setMode(data.modeUsed);
                      setDiagnostics(
                        JSON.stringify(data.diagnostics) + (data.note ? ` · ${data.note}` : ""),
                      );
                    })}
                  >
                    <div className="kb-grow">
                      <Input
                        label={t.query}
                        required
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <Button type="submit" disabled={busy || !query.trim()}>
                      {t.search}
                    </Button>
                  </form>
                  <form
                    className="kb-row"
                    onSubmit={submit(async () =>
                      setHits([
                        await api<Hit>(`/${library}/chunks/${encodeURIComponent(chunkLookup)}`),
                      ]),
                    )}
                  >
                    <Input
                      label={t.lookup}
                      value={chunkLookup}
                      onChange={(e) => setChunkLookup(e.target.value)}
                    />
                    <Button type="submit" disabled={busy || !chunkLookup}>
                      {t.full}
                    </Button>
                  </form>
                  {mode && (
                    <p className="kb-muted">
                      {t.mode}: {mode}
                    </p>
                  )}
                  {diagnostics && (
                    <details>
                      <summary>{t.diagnostics}</summary>
                      <pre>{diagnostics}</pre>
                    </details>
                  )}
                </details>
                {hits === null && !error && (
                  <p role="status">{lang === "zh" ? "正在读取引用证据…" : "Loading evidence…"}</p>
                )}
                {hits?.length === 0 && <p>{t.noHits}</p>}
                {hits?.map((hit) => (
                  <CitationEvidence
                    key={`${hit.libraryId}:${hit.chunkId}`}
                    hit={hit}
                    api={api}
                    lang={lang}
                  />
                ))}
              </section>
              <section hidden={view !== "review"}>
                <h2>
                  {t.review} ({pending.length} {t.count})
                </h2>
                <p className="kb-muted">{t.reviewHint}</p>
                {!pending.length && <p>{t.noPending}</p>}
                {candidates.map((c) => (
                  <article key={c.id}>
                    <h3>
                      {c.title} ·{" "}
                      {c.status === "pending"
                        ? t.pending
                        : c.status === "accepted"
                          ? t.accepted
                          : t.rejected}
                    </h3>
                    <small>
                      {c.kind === "import" ? t.importKind : t.findingKind} · {c.reviewed_by}{" "}
                      {c.reviewed_at}
                    </small>
                    <pre>{c.conclusion}</pre>
                    <p>
                      {t.conditions}: {c.conditions}
                    </p>
                    <details>
                      <summary>{t.evidence}</summary>
                      <pre>{c.evidence.join("\n")}</pre>
                      <small>{c.provenance.join(" / ")}</small>
                      {c.provenance[2] && (
                        <p>
                          <a
                            href={`/chat/${encodeURIComponent(c.provenance[2])}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t.trace}
                          </a>
                        </p>
                      )}
                    </details>
                    {c.status === "pending" && (
                      <div className="kb-row">
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await api(`/${library}/candidates/${c.id}/review`, "POST", {
                                decision: "accept",
                              });
                              await load(library);
                              setNotice(t.handled);
                            })
                          }
                        >
                          {t.accept}
                        </Button>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await api(`/${library}/candidates/${c.id}/review`, "POST", {
                                decision: "reject",
                              });
                              await load(library);
                              setNotice(t.handled);
                            })
                          }
                        >
                          {t.reject}
                        </Button>
                      </div>
                    )}
                  </article>
                ))}
              </section>
            </>
          )}
        </div>
      </Modal>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
