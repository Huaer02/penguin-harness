# Ingestion

Knowledge belongs to a selected Project library. Use `kb_libraries` to inspect connections,
then pass an explicit `libraryId` to `kb_ingest` with `source`, `title` and `text`.
Agents with explicit direct-import permission and library contribution access publish requested
original documents immediately. Other Agent imports remain pending. Human management-page imports
publish directly. Always report the returned status; autonomous findings remain reviewed. Read local files with the existing sandbox-aware file tools; fetch web material with the
available browsing tools and preserve its original URL. Binary formats need extraction.

The source address identifies updates within a library; titles do not identify a source.
Unchanged text and embedding configuration are skipped. Changed content creates a new
version; old citation chunks remain readable while default search uses the current version.
Markdown headings guide chunking, and returned spans refer to the preserved text snapshot.
Automatic task findings use `kb_propose` and require human review, not direct ingestion.
