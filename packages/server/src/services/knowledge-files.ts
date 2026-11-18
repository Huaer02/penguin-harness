/** Bounded source extraction; originals are stored by the route before indexing. */
export async function extractKnowledgeFile(
  bytes: Uint8Array,
  name: string,
): Promise<{ text: string; warning?: string }> {
  if (bytes.length > 25 * 1024 * 1024) throw new Error("文件超过 25 MB，请拆分后导入。");
  if (/\.pdf$/i.test(name)) {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: true,
    });
    try {
      const doc = await task.promise;
      if (doc.numPages > 500) throw new Error("PDF 超过 500 页，请拆分后导入。");
      const pages: string[] = [];
      let size = 0;
      for (let page = 1; page <= doc.numPages; page++) {
        const content = await (await doc.getPage(page)).getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
          .join("");
        size += text.length;
        if (size > 2_000_000) throw new Error("提取正文超过 200 万字符，请拆分后导入。");
        pages.push(`\n[Page ${page}]\n${text}`);
      }
      if (!pages.some((p) => p.replace(/\[Page \d+\]/g, "").trim()))
        throw new Error("PDF 没有可提取文字，扫描件需要 OCR。");
      return {
        text: pages.join("\n"),
        warning: "已提取文字并保留页码；图片和公式未执行 OCR，请核对原文。",
      };
    } finally {
      await task.destroy();
    }
  }
  if (!/\.(txt|md|markdown|csv|json|log)$/i.test(name))
    throw new Error("支持 PDF、UTF-8 文本和 Markdown。");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text.trim() || text.length > 2_000_000) throw new Error("正文为空或超过 200 万字符。");
  return { text };
}
