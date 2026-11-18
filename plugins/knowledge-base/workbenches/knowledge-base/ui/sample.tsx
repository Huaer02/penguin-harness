import { useRef, useState } from "react";
import { Button } from "@prismshadow/penguin-ui";
import type { Api } from "./manage.js";
import { importSample } from "./sample-import.js";
import type { SampleItem, SampleProgress } from "./sample-import.js";
import { workbenchContext } from "./context.js";
const questions = [
  [
    "财务管控 train_001：请对 CLM-2025-OPS-017 等报销申请完成关账审查，区分已结清、可保留和需要处理的申请。依据现有资料说明哪些判断无法完成。",
    "Financial control train_001: review the close status of the specified reimbursement claims. Identify which decisions cannot be made from the available documents.",
  ],
  [
    "法院书记员 train_001：为 2025 年 6 月 9 日刑事案件日程准备结案材料，需要核对哪些案件、费用和记录？指出缺失的附件及系统数据。",
    "Court clerk train_001: prepare the June 9, 2025 criminal docket closeout. Identify the cases, fees, records, and missing attachments or portal data.",
  ],
  [
    "GDPEvo Essential 包含哪六个场景？每个场景的训练题与测试题如何安排？请引用资料。",
    "Which six scenarios make up GDPEvo Essential, and how are training and test tasks organized? Cite the sources.",
  ],
  [
    "对比服务工单处理与财务管控的 train_001：各自需要读取什么信息，交付什么结果？请分别引用。",
    "Compare train_001 in service-ticket-resolution and financial-control: required inputs and outputs. Cite each task.",
  ],
  [
    "法院书记员场景的 train_001 涉及哪些案件？要求哪些输出内容？只依据题面回答，不要执行任务。",
    "Which cases and outputs are named in court-clerk-operations train_001? Answer from the task description without executing it.",
  ],
  [
    "只根据现有知识库，能否算出投资组合场景 train_001 的最终答案？说明还缺少哪些信息，不要猜测。",
    "Can the final answer to portfolio-management train_001 be calculated from this library alone? Identify missing information without guessing.",
  ],
];
export function SamplePanel({
  api,
  lang,
  refresh,
  openLibrary,
  manageAccess,
}: {
  api: Api;
  lang: "zh" | "en";
  refresh: (id: string) => Promise<void>;
  openLibrary: () => void;
  manageAccess: () => void;
}) {
  const zh = lang === "zh";
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SampleProgress | null>(null);
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  async function run() {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    setReady(false);
    setFailures([]);
    try {
      const ctx = workbenchContext(location.pathname);
      const key = `knowledge-sample:${ctx.projectApi}:gdpevo-v1`;
      const response = await fetch(new URL("./samples/gdpevo/corpus.json", location.href), {
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(`Sample data: HTTP ${response.status}`);
      const data = (await response.json()) as { id: string; items: SampleItem[] };
      if (
        data.id !== "gdpevo-essential-starter-v1" ||
        data.items?.length !== 12 ||
        data.items.some((i) => typeof i.text !== "string" || typeof i.source !== "string")
      )
        throw new Error("Invalid GDPEvo sample data");
      const perform = async () => {
        let previous: string | null = null;
        try {
          previous = localStorage.getItem(key);
        } catch {
          /* Marker lookup still works. */
        }
        const result = await importSample(
          api,
          data.items,
          previous,
          (id) => {
            try {
              localStorage.setItem(key, id);
            } catch {
              /* No browser storage. */
            }
          },
          setProgress,
        );
        setFailures(result.failures);
        await refresh(result.libraryId);
        setReady(result.failed === 0);
      };
      // Serialize imports from same-origin tabs; the server still performs normal owner checks.
      if (navigator.locks) await navigator.locks.request(key, perform);
      else await perform();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="kb-stack">
      <section className="kb-panel-card kb-stack">
        <h2>GDPEvo Essential</h2>
        <p>
          {zh
            ? "六个场景 · 12 份资料 · 离线可导入"
            : "Six scenarios · 12 documents · Bundled offline"}
        </p>
        <p className="kb-muted">
          {zh
            ? "每个场景包含训练说明和第一道训练题面：服务工单、财务管控、投资组合、医保审核、法院书记员、工程组合。用于体验检索与引用，不包含完整业务系统、附件或标准答案。"
            : "Training guide and first task for each of six scenarios. Explore retrieval and citations; complete environments, attachments and answer keys are not included."}
        </p>
        <p className="kb-muted">
          {zh
            ? "点击后创建独立示例库；再次点击只补充缺失资料，保留已有编辑。默认不共享，Agent 访问权限在创建后单独设置。"
            : "Creates a separate library. Repeated imports fill missing sources and preserve edits. Sharing and agent access are configured separately."}
        </p>
        <div className="kb-row">
          <Button variant="primary" disabled={busy} onClick={() => void run()}>
            {busy
              ? zh
                ? "正在导入…"
                : "Importing…"
              : zh
                ? "创建 / 继续导入示例"
                : "Create / resume sample"}
          </Button>
          {ready && (
            <>
              <Button onClick={openLibrary}>{zh ? "浏览示例资料" : "Browse documents"}</Button>
              <Button onClick={manageAccess}>
                {zh ? "设置 Agent 访问权限" : "Configure agent access"}
              </Button>
            </>
          )}
        </div>
        {progress && (
          <div role="status" aria-live="polite">
            <progress
              value={progress.completed}
              max={progress.total}
              aria-label={zh ? "导入进度" : "Import progress"}
            />
            <p>
              {progress.completed}/{progress.total} · {zh ? "新导入" : "Imported"}{" "}
              {progress.imported} · {zh ? "已保留" : "Preserved"} {progress.preserved} ·{" "}
              {zh ? "失败" : "Failed"} {progress.failed}
            </p>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {!!failures.length && (
          <details open>
            <summary>{zh ? "失败资料（可再次点击重试）" : "Failed sources (retry import)"}</summary>
            <ul>
              {failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section className="kb-panel-card kb-stack">
        <h2>{zh ? "试试这些问题" : "Example questions"}</h2>
        <p className="kb-muted">
          {zh
            ? "为 Agent 开启此库的读取权限后，在新对话中提问。"
            : "Give an agent read access, then ask in a new conversation."}
        </p>
        {questions.map((q, i) => (
          <div className="kb-setting-group kb-stack" key={i}>
            <p>{q[zh ? 0 : 1]}</p>
            <div>
              <Button
                onClick={() => {
                  void navigator.clipboard
                    .writeText(q[zh ? 0 : 1]!)
                    .then(() => setCopied(i))
                    .catch(() =>
                      setError(
                        zh
                          ? "无法自动复制，请选中问题文字手动复制。"
                          : "Select and copy the question manually.",
                      ),
                    );
                }}
              >
                {copied === i ? (zh ? "已复制" : "Copied") : zh ? "复制问题" : "Copy question"}
              </Button>
            </div>
          </div>
        ))}
        <details>
          <summary>{zh ? "资料来源与许可" : "Source and license"}</summary>
          <p>Prism-Shadow/GDPevo · Apache-2.0</p>
          <a
            href="https://github.com/Prism-Shadow/penguin-harness-benchmark/tree/8a507af0329fed8f9a1baf44d1364b438340c78a"
            target="_blank"
            rel="noreferrer"
          >
            {zh ? "查看资料快照" : "View source snapshot"}
          </a>
          <p className="kb-muted">
            {zh
              ? "示例随插件提供固定快照，不自动追踪上游更新。"
              : "A fixed snapshot bundled with the plugin; upstream changes are not applied automatically."}
          </p>
        </details>
      </section>
    </div>
  );
}
