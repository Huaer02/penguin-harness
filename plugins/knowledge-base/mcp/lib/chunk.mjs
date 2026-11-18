// Markdown-aware chunking for the knowledge base: sections open at headings, paragraphs
// (with code fences kept whole) are packed up to a target size, and an oversized block is
// split at line boundaries with an overlap. Every chunk keeps its verbatim span, so a
// citation can quote `text.slice(span[0], span[1])` from the original document.

const HEADING = /^#{1,6}\s+\S/;
const FENCE = /^\s*(```|~~~)/;

/**
 * One block: a run of lines that belongs together — a paragraph, a heading line, a fenced
 * code block — with its heading context and verbatim offsets into the source text.
 */
function blocksOf(text) {
  const blocks = [];
  let heading = "";
  let fence = null;
  let current = [];
  let currentStart = 0;
  let currentHeading = "";
  let offset = 0;

  const flush = (end) => {
    const blockText = current.join("\n");
    if (blockText.trim()) {
      blocks.push({ text: blockText, heading: currentHeading, start: currentStart, end });
    }
    current = [];
  };

  for (const line of text.split("\n")) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;

    if (fence !== null) {
      current.push(line);
      if (line.trim().startsWith(fence)) fence = null;
      continue;
    }
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      flush(lineStart);
      currentStart = lineStart;
      currentHeading = heading;
      current = [line];
      fence = fenceMatch[1];
      continue;
    }
    if (HEADING.test(line)) {
      flush(lineStart);
      heading = line.trim();
      currentStart = lineStart;
      currentHeading = heading;
      current = [line];
      continue;
    }
    if (line.trim() === "") {
      flush(lineStart);
      continue;
    }
    if (current.length === 0) {
      currentStart = lineStart;
      currentHeading = heading;
    }
    current.push(line);
  }
  flush(text.length);
  return blocks;
}

/**
 * Split `text` into chunks of at most `targetChars` (an oversized block is split further),
 * each carrying the nearest preceding Markdown heading and its verbatim [start, end] span.
 */
export function chunkText(text, { targetChars = 1200, overlapChars = 150 } = {}) {
  if (typeof text !== "string" || !text.trim()) return [];
  const chunks = [];

  let pack = null; // { heading, start, end }
  const flushPack = () => {
    if (pack === null) return;
    chunks.push({
      text: text.slice(pack.start, pack.end),
      heading: pack.heading,
      start: pack.start,
      end: pack.end,
    });
    pack = null;
  };

  for (const block of blocksOf(text)) {
    const size = block.end - block.start;
    if (size > targetChars) {
      flushPack();
      splitOversized(text, block, targetChars, overlapChars, chunks);
      continue;
    }
    if (pack !== null && (pack.heading !== block.heading || block.end - pack.start > targetChars)) {
      flushPack();
    }
    if (pack === null) pack = { heading: block.heading, start: block.start, end: block.start };
    pack.end = block.end;
  }
  flushPack();
  return chunks;
}

/** Line-boundary windows over one oversized block, overlapping by up to `overlapChars`. */
function splitOversized(text, block, targetChars, overlapChars, chunks) {
  const overlap = Math.min(Math.max(0, overlapChars), Math.max(0, targetChars - 1));
  for (let start = block.start; start < block.end;) {
    let end = Math.min(start + targetChars, block.end);
    if (end < block.end) {
      const newline = text.lastIndexOf("\n", end - 1);
      if (newline > start + overlap) end = newline + 1;
    }
    chunks.push({ text: text.slice(start, end), heading: block.heading, start, end });
    if (end === block.end) break;
    start = Math.max(start + 1, end - overlap);
  }
}
