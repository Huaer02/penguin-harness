# Retrieval

Call `kb_search` with an explicit `libraryIds` array and `query`. All selected libraries must
be connected; unauthorized scope is refused. Modes are `lexical`, `semantic` and `hybrid`.
Lexical BM25 works offline; hybrid fuses lexical and compatible stored embedding rankings
with RRF. Check `modeUsed` and the fallback note. Host embedding settings select endpoint,
model and dimensions; re-ingestion with a new configuration creates compatible vectors.
Pending and rejected candidates are excluded. Use `kb_get` to inspect a versioned chunk.
