import { useState } from "react";
import { Button } from "@prismshadow/penguin-ui";
import type { Api } from "./manage.js";
import { workbenchContext } from "./context.js";
import { evidenceContext } from "./citation-context.js";

export type EvidenceHit = {
  chunkId: string;
  versionId: string;
  libraryId: string;
  sourceId: string;
  title: string;
  heading?: string;
  span: number[];
  source: string;
  text: string;
  current: boolean;
  enabled?: boolean;
  citationUrl?: string;
};

export function CitationEvidence({
  hit,
  api,
  lang,
}: {
  hit: EvidenceHit;
  api: Api;
  lang: "zh" | "en";
}) {
  const zh = lang === "zh";
  const [context, setContext] = useState<ReturnType<typeof evidenceContext>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showContext, setShowContext] = useState(false);
  const file = /^knowledge-file:\/\/([a-f0-9]{64})\//.exec(hit.source);
  async function loadContext() {
    if (context) {
      setShowContext(!showContext);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const doc = await api<{ versions: { versionId: string; text: string }[] }>(
        `/${encodeURIComponent(hit.libraryId)}/documents/${encodeURIComponent(hit.sourceId)}`,
      );
      const found = evidenceContext(doc.versions, hit);
      if (!found)
        throw new Error(
          zh
            ? "无法定位此引用的原版本上下文；下方引用片段仍可查阅。"
            : "The original version context could not be located. The cited passage remains available below.",
        );
      setContext(found);
      setShowContext(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="kb-evidence kb-stack">
      <header className="kb-evidence-heading">
        <p className="kb-muted">{zh ? "引用证据" : "Citation evidence"}</p>
        <h2>{hit.title}</h2>
        {hit.heading && <p className="kb-muted">{hit.heading.replace(/^#{1,6}\s+/, "")}</p>}
        <div className="kb-row">
          <span className="kb-evidence-state">
            {hit.current
              ? zh
                ? "当前版本"
                : "Current version"
              : zh
                ? "历史版本"
                : "Historical version"}
          </span>
          {hit.enabled === false && (
            <span className="kb-evidence-state">{zh ? "资料已停用" : "Source disabled"}</span>
          )}
        </div>
      </header>
      {(!hit.current || hit.enabled === false) && (
        <p className="kb-evidence-warning">
          {zh
            ? "这是回答所引用的保留证据。资料已更新或停用，请勿将其直接视为当前有效信息。"
            : "This is the preserved evidence cited by the answer. The source has changed or is disabled; it may no longer be current."}
        </p>
      )}
      <section className="kb-evidence-passage">
        <h3>{zh ? "原文片段" : "Cited passage"}</h3>
        <p className="kb-muted">
          {zh
            ? "展示知识库保存的文本片段；PDF 来源为提取文本，不代表原文件页码或版式。"
            : "Text preserved in the library. PDF text does not retain the original page layout or page location."}
        </p>
        <pre>{hit.text}</pre>
      </section>
      <div className="kb-row">
        <Button disabled={busy} onClick={() => void loadContext()}>
          {busy
            ? zh
              ? "读取中…"
              : "Loading…"
            : showContext
              ? zh
                ? "收起上下文"
                : "Hide context"
              : zh
                ? "查看同版本上下文"
                : "Show version context"}
        </Button>
        {/^https?:\/\//i.test(hit.source) && (
          <a href={hit.source} target="_blank" rel="noreferrer">
            {zh ? "打开来源网页" : "Open source page"}
          </a>
        )}
        {file && (
          <a
            href={`${workbenchContext(location.pathname).projectApi}/knowledge-bases/${encodeURIComponent(hit.libraryId)}/files/${file[1]}`}
            download
          >
            {zh ? "下载原文件" : "Download original file"}
          </a>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {showContext && context && (
        <section className="kb-evidence-context">
          <h3>{zh ? "同版本上下文" : "Context from the cited version"}</h3>
          <p className="kb-muted">
            {zh
              ? "高亮区域为引用片段，前后各展示最多 600 个字符。"
              : "The cited passage is highlighted, with up to 600 characters on either side."}
          </p>
          <pre>
            {context.leading ? "…\n" : ""}
            {context.before}
            <mark>{context.passage}</mark>
            {context.after}
            {context.trailing ? "\n…" : ""}
          </pre>
        </section>
      )}
      <details className="kb-evidence-metadata">
        <summary>{zh ? "来源与技术详情" : "Source and technical details"}</summary>
        <dl>
          <dt>{zh ? "来源地址" : "Source"}</dt>
          <dd>{hit.source}</dd>
          <dt>{zh ? "知识库 ID" : "Library ID"}</dt>
          <dd>{hit.libraryId}</dd>
          <dt>{zh ? "版本 ID" : "Version ID"}</dt>
          <dd>{hit.versionId}</dd>
          <dt>{zh ? "片段 ID" : "Chunk ID"}</dt>
          <dd>{hit.chunkId}</dd>
          <dt>
            {zh
              ? "文本字符范围（从 0 开始，结束位置不含）"
              : "Text range (zero-based, end exclusive)"}
          </dt>
          <dd>{hit.span.join(" – ")}</dd>
        </dl>
      </details>
    </article>
  );
}
