# Knowledge citations

Attach a footnote to the claim it supports. Keep the list readable; technical identifiers
belong in the evidence view, not in the answer.

```markdown
这项结论有两处原文支持。[^1], [^2]
另一处论述也使用第一段证据。[^1]

[^1]: 《文档标题》· 章节名称 · [查看证据](RETURNED_CITATION_URL_1)
[^2]: 《文档标题》· 另一章节 · [查看证据](RETURNED_CITATION_URL_2)
```

Replace placeholders with actual retrieved titles, headings and exact `citationUrl` values.
Omit a heading when it is unavailable. Use the answer's language for link labels. Never
concatenate footnote references: the shared chat renderer may display them as one number.
The comma is a generation convention, not a renderer guarantee.

Reuse one number for the same `(libraryId, chunkId)`. Distinct chunks in the same document
remain distinct evidence. Do not collapse them merely because their titles match. Avoid
"same as above" as a title: each source note should make sense on its own.

Use `kb_get` with the returned library and chunk IDs to verify quotations. A chunk identifies
an immutable version and text span, not a PDF page or a precise sentence. Never invent page
numbers or claim sentence-level highlighting. Updates must not silently replace old evidence.
Label historical or disabled evidence explicitly. Access can still be revoked.

Do not print UUIDs, internal upload addresses or redundant filenames unless requested.
Include an external original-article link only when explicitly available and relevant;
do not infer it from a document title or substitute it for the versioned evidence link.
Do not invent a host to turn a relative citation URL into an absolute one. Ordinary footnote
numbers jump to the source list; the evidence link opens the knowledge evidence view when
supported by the host. The plugin does not change the host's link routing or Markdown renderer.
