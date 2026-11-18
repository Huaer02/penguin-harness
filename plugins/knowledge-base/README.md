# Project knowledge libraries

Install or update **Knowledge Base** on agents that need knowledge tools. Open the single
**App Center → Project Knowledge** entry to manage Project libraries. The Agent hosting the
workbench is not the owner of its libraries. Creating a library in the page does not implicitly
connect that hosting Agent. Choose connections and grants explicitly in Settings.

The page separates documents, uploads, search, review and settings. Upload PDF, UTF-8 text or
Markdown files (25 MB per file, 50 files per batch); the page sends each file independently,
extracts text, retains the original and reports per-file outcomes. PDF text retains page labels;
image OCR is not included. Download originals from the document list. JSON snapshots include
extracted text and permissions; back up the originals directory separately for binary files.

A Project-shared library is readable by current and future Project Agents. Writing still needs
contribution access. Existing libraries remain restricted until an owner explicitly enables
sharing. Autonomous findings require human review. Visible pending counts refresh every 15
seconds; there are no OS notifications.

This implementation needs this checkout's server and core changes; importing only the plugin
into an older released host does not add the knowledge APIs or native tools.

## Create a library through an agent

A human Project owner opens **Project Knowledge → Settings**, explicitly selects the target Agent,
and enables library creation. To let it publish requested original documents without another review,
also enable direct source imports. This grant is off by default and can be
revoked without deleting existing libraries or their connections. Then start a new conversation
with the updated plugin and ask the agent to create a named library from specified files.

`kb_create {name, requestId}` creates one Project-owned library and connects only the calling
agent with contribution access. Reusing the same request ID on that agent returns the same
library; a different name with that ID fails. New IDs can create separate libraries with the
same display name. Retries preserve an owner's connection revocations or permission downgrades.
The agent uses `kb_ingest` or `kb_ingest_batch`: direct-import grantees with contribution access
publish original documents immediately; other contributors submit candidates for review. Creation
does not grant direct-import, connection management or review authority. Autonomous findings always
use `kb_propose` and remain pending.
Creation grants currently identify agents by Project/Agent ID, like existing connections;
deletion through the platform removes grants, connections and creation retry records before ID reuse, while retaining Project libraries and historical provenance.

## Agent tools

`kb_create`, `kb_libraries`, `kb_ingest`, `kb_ingest_batch`, `kb_search`, `kb_get`, `kb_sources` and `kb_propose` are installed
by the server's host assembly when the agent carries the Skill. Project/agent/session identity
is fixed by the host. No tool accepts an arbitrary knowledge directory. The source text can
come from existing sandbox-aware file tools or browsing tools; binary extraction is external.

Knowledge is stored under the host data root at `knowledge-base/resources.db`, independently
of Agent State. Do not expose this database as an agent-writable Workspace. Library-level
checks are application authorization and do not isolate a process with unrestricted host
filesystem access. `requireHuman` follows the platform's existing credential guarantees.

## Manage and maintain knowledge

The workbench supports library names/descriptions, archive/unarchive, source browsing,
full version history, explicit document updates, enable/disable, and per-item import records.
Archiving rejects Agent access and contribution while preserving connections and history;
unarchiving restores access according to those connections. Disabling excludes a source from
new searches; existing authorized readers can still inspect its historical chunks and state.
Updates do not silently re-enable disabled documents.

Batch imports accept up to 50 items and 8 million serialized characters. UI files must be
UTF-8 text/Markdown and at most 2 MB each. Use a distinct directory identifier or full source
path for same-name files. A batch never implicitly overwrites changed existing content:
choose an explicit update from document history, which checks the version you read.
Unchanged items are reused; failures are stored and can be retried. File read/format failures
need corrected input. Human retries cannot impersonate Agent submitters; agents resubmit
failed materials through their own tools.

A source has a stable ID derived from library ID and source address; titles do not identify it.
Renaming or moving an external file does not automatically rename its source identity.
Use the existing document's update action to preserve identity. Citation links open the exact
version in the workbench. Search diagnostics show actual mode and searchable source/chunk
counts; absence, ingest failure and incorrect generation should be investigated separately.

## Backup and restore

**Backup and recovery** downloads a versioned JSON snapshot of the Project's libraries,
sources, versions, candidates, import history, connections and creation grants. It contains
source text; protect it accordingly. Model credentials are not included. Restore accepts files
up to 18 MB, requires the same Project ID, and refuses a nonempty knowledge area (including
creation grants). Recreate the Project and desired Agent IDs in a fresh host data root, install
this plugin, then restore from the workbench. Missing Agent connections/grants are skipped
and counted rather than attached to arbitrary agents. Historical chunk IDs are preserved.
Restore validates the snapshot and commits all rows atomically; invalid files roll back.
This is recovery into an empty area, not a merge/overwrite or cross-Project migration tool.

Existing SQLite data upgrades additively on open; old versioned citation IDs remain valid.

## Semantic retrieval

Set `KB_EMBEDDINGS_URL`, `KB_EMBEDDINGS_KEY` and `KB_EMBEDDINGS_MODEL` on the server process;
optionally set `KB_EMBEDDINGS_DIMENSIONS`. Restart the host to change environment settings.
The model and endpoint signature is stored with vectors; re-ingest sources to generate
compatible vectors after changes. Historical chunks stay readable. With no configuration,
search is lexical and reports its fallback. No live embedding credential is needed for tests.

## Findings and review

The stop hook reviews tasks exceeding 30 completed turns. It searches existing knowledge and
submits at most one coherent candidate to an unambiguous contribution library. If several
libraries are writable, the user must select a target; extraction skips rather than guessing.
Manual `kb_propose` calls work for shorter tasks too. Use a stable, globally distinct source
task ID including the source Session ID, so extraction retries can be deduplicated.

Agent `kb_ingest` calls also create pending imports; only explicit human management-page
imports publish directly. Pending and rejected candidates never enter default retrieval. Human acceptance atomically
publishes the conclusion, conditions and evidence references. Evidence references are proposed
by the extraction model and must be checked by the reviewer; they are not automatically
verified factual claims. Accepted findings currently enter the lexical index; semantic
indexing can be added by re-ingesting that source with host embeddings configured.

The legacy private JSONL MCP prototype is no longer contributed by the plugin. Its data is
not automatically migrated. Standalone SDK/CLI hosts must supply the host tools themselves;
this implementation does not silently fall back to private storage.

## Bundled GDPEvo example

Use **New → Try GDPEvo sample**, or the empty-library starter button. The plugin bundles
12 fixed-snapshot documents: a training guide and the first training task description for
each of GDPEvo Essential's six scenarios. A user action creates a separate library and imports
the documents with per-item progress; installation alone does not write knowledge data.
The sample panel offers four copyable questions and an explicit agent-access settings link.
It does not grant sharing, agent connections, creation permissions or contribution access.

A marked library (or the browser's remembered library ID) is reused on subsequent clicks,
including after renaming. Existing source addresses are preserved without overwriting user
edits or re-enabling disabled documents. Failed or missing sources can be retried. Archived
samples require explicit unarchiving. Ambiguous marked libraries are reported instead of
choosing one. Same-origin browser tabs serialize imports when Web Locks is available;
creation across different devices is not globally transactional with the current host API.
If a user removes the sample marker and clears browser storage, it is no longer recognized.
Nothing automatically recreates or updates a sample after removal; clicking import again is
an explicit request to create/resume it. Upstream updates do not overwrite the snapshot.

Sources, licenses and notices ship under `workbenches/knowledge-base/ui/samples/gdpevo/`,
which is included by the existing package `files: ["workbenches", ...]` declaration.
The sample contains no held-out tasks, answer keys, graders or complete business systems;
it is for knowledge retrieval and citations, not a runnable GDPEvo evaluation environment.
