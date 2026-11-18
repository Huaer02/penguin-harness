import { column } from "./schema.mjs";
import { sourceAddress, sourceId } from "./source.mjs";
import { exportSnapshot, restoreSnapshot } from "./snapshot.mjs";
import { embeddingsConfig, embedTexts } from "../mcp/lib/embed.mjs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { KnowledgeResources } from "./resources.mjs";
import { chunkText } from "../mcp/lib/chunk.mjs";
import { bm25, buildIndex, cosine, rrfFuse } from "../mcp/lib/rank.mjs";

/** Versioned source snapshots and human-reviewed findings in host-owned storage. */
export class KnowledgeContent extends KnowledgeResources {
  #db;
  #embedding;
  constructor(filename, authorizeOwner, embedding = null) {
    super(filename, authorizeOwner);
    this.#embedding = embedding;
    this.#db = new DatabaseSync(filename);
    this.#db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS knowledge_versions (
        id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES knowledge_libraries(id),
        source TEXT NOT NULL, title TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL,
        chunks TEXT NOT NULL, embedding TEXT NOT NULL, current INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS knowledge_source ON knowledge_versions(library_id,source,current);
      CREATE TABLE IF NOT EXISTS knowledge_candidates (
        id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES knowledge_libraries(id),
        task_key TEXT NOT NULL, title TEXT NOT NULL, conclusion TEXT NOT NULL,
        conditions TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL,
        reviewed_by TEXT, reviewed_at TEXT, version_id TEXT,
        UNIQUE(library_id,task_key)
      );
      CREATE TABLE IF NOT EXISTS knowledge_sources (
        id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES knowledge_libraries(id),
        source TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
        UNIQUE(library_id,source)
      );
      CREATE TABLE IF NOT EXISTS knowledge_import_items (
        id TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES knowledge_libraries(id),
        actor_key TEXT NOT NULL, item_key TEXT NOT NULL, title TEXT NOT NULL,
        source TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL,
        error TEXT, result TEXT, created_at TEXT NOT NULL,
        UNIQUE(library_id,actor_key,item_key)
      );`);
    column(this.#db, "knowledge_import_items", "input", "TEXT NOT NULL DEFAULT '{}'");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const legacy = !this.#db
        .prepare("PRAGMA table_info(knowledge_candidates)")
        .all()
        .some((c) => c.name === "kind");
      column(this.#db, "knowledge_candidates", "kind", "TEXT NOT NULL DEFAULT 'finding'");
      column(this.#db, "knowledge_candidates", "source", "TEXT");
      column(this.#db, "knowledge_candidates", "base_version", "TEXT");
      if (legacy)
        this.#db
          .prepare(
            `UPDATE knowledge_candidates SET kind='import',source=json_extract(evidence,'$[0]')
        WHERE json_extract(task_key,'$[3]') LIKE 'source-import:%'`,
          )
          .run();
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
    for (const row of this.#db
      .prepare(
        "SELECT DISTINCT v.library_id,v.source FROM knowledge_versions v WHERE NOT EXISTS (SELECT 1 FROM knowledge_sources s WHERE s.library_id=v.library_id AND s.source=v.source)",
      )
      .all())
      this.#db
        .prepare("INSERT OR IGNORE INTO knowledge_sources(id,library_id,source) VALUES (?,?,?)")
        .run(sourceId(row.library_id, row.source), row.library_id, row.source);
  }
  close() {
    this.#db.close();
    super.close();
  }
  async #access(actor, libraryId, operation = "read") {
    if (actor.kind === "agent") return this.requireAccess(actor, libraryId, operation);
    const libraries = await this.listManaged(actor);
    const library = libraries.find((l) => l.id === libraryId);
    if (!library) throw new Error("knowledge library unavailable");
    if (operation === "contribute" && library.archived) throw new Error("library archived");
  }
  #text(value, name, max = 2_000_000) {
    if (typeof value !== "string" || !value.trim() || value.length > max)
      throw new Error(`${name} must be non-empty text`);
    return value.trim();
  }
  #transaction(run) {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  #save(libraryId, input, chunks, embedding) {
    const hash = createHash("sha256").update(input.text).digest("hex");
    const existing = this.#db
      .prepare(
        "SELECT id,hash,embedding,title FROM knowledge_versions WHERE library_id=? AND source=? AND current=1",
      )
      .get(libraryId, input.source);
    if (
      existing?.hash === hash &&
      existing.embedding === embedding &&
      existing.title === input.title
    )
      return { versionId: existing.id, unchanged: true };
    if (input.expectedVersion !== undefined && (existing?.id ?? null) !== input.expectedVersion)
      throw new Error("source version conflict");
    this.#db
      .prepare("INSERT OR IGNORE INTO knowledge_sources(id,library_id,source) VALUES (?,?,?)")
      .run(sourceId(libraryId, input.source), libraryId, input.source);
    const id = randomUUID();
    this.#db
      .prepare("UPDATE knowledge_versions SET current=0 WHERE library_id=? AND source=?")
      .run(libraryId, input.source);
    this.#db
      .prepare(
        "INSERT INTO knowledge_versions(id,library_id,source,title,hash,body,chunks,embedding,current,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)",
      )
      .run(
        id,
        libraryId,
        input.source,
        input.title,
        hash,
        input.text,
        JSON.stringify(chunks),
        embedding,
        new Date().toISOString(),
      );
    return { versionId: id, unchanged: false };
  }
  async ingest(actor, libraryId, input, directImport = false) {
    await this.#access(actor, libraryId, "contribute");
    const source = sourceAddress(input.source),
      title = this.#text(input.title, "title", 200);
    this.#text(input.text, "text");
    if (input.text.length > 2_000_000) throw new Error("text exceeds 2000000 characters");
    const embedding = this.#embedding?.id ?? "";
    const prior = this.#db
      .prepare(
        "SELECT id,hash,title,embedding FROM knowledge_versions WHERE library_id=? AND source=? AND current=1",
      )
      .get(libraryId, source);
    const hash = createHash("sha256").update(input.text).digest("hex");
    // Skip before paid embedding; the transaction still rechecks after any network wait.
    if (prior?.hash === hash && prior.title === title && prior.embedding === embedding)
      return { versionId: prior.id, unchanged: true };
    if (input.expectedVersion !== undefined && (prior?.id ?? null) !== input.expectedVersion)
      throw new Error("source version conflict");
    const chunks = chunkText(input.text);
    if (this.#embedding) {
      const vectors = await this.#embedding.embed(chunks.map((c) => c.text));
      if (!Array.isArray(vectors) || vectors.length !== chunks.length)
        throw new Error("invalid embedding response");
      chunks.forEach((c, i) => {
        if (!Array.isArray(vectors[i]) || !vectors[i].length || !vectors[i].every(Number.isFinite))
          throw new Error("invalid embedding vector");
        c.vector = vectors[i];
      });
    }
    await this.#access(actor, libraryId, "contribute");
    if (directImport && actor.kind === "agent" && !this.canImport(actor))
      throw new Error("direct import permission revoked");
    return this.#transaction(() =>
      this.#save(
        libraryId,
        { source, title, text: input.text, expectedVersion: input.expectedVersion },
        chunks,
        embedding,
      ),
    );
  }
  async sources(actor, libraryId) {
    await this.#access(actor, libraryId);
    return this.#db
      .prepare(
        `SELECT s.id AS sourceId,v.id AS versionId,v.source,v.title,
      v.created_at AS createdAt,s.enabled,json_array_length(v.chunks) AS chunkCount
      FROM knowledge_versions v JOIN knowledge_sources s ON s.library_id=v.library_id AND s.source=v.source
      WHERE v.library_id=? AND v.current=1 ORDER BY v.created_at,v.id`,
      )
      .all(libraryId)
      .map((r) => ({ ...r, enabled: !!r.enabled }));
  }
  async document(actor, libraryId, id) {
    await this.#access(actor, libraryId);
    const source = this.#db
      .prepare("SELECT * FROM knowledge_sources WHERE id=? AND library_id=?")
      .get(id, libraryId);
    if (!source) throw new Error("source unavailable");
    const versions = this.#db
      .prepare(
        "SELECT * FROM knowledge_versions WHERE library_id=? AND source=? ORDER BY rowid DESC",
      )
      .all(libraryId, source.source);
    return {
      sourceId: id,
      source: source.source,
      enabled: !!source.enabled,
      versions: versions.map((r) => ({
        versionId: r.id,
        title: r.title,
        text: r.body,
        createdAt: r.created_at,
        current: !!r.current,
        processing: { chunkCount: JSON.parse(r.chunks).length, embedded: !!r.embedding },
        chunks: JSON.parse(r.chunks).map((c, i) => this.#public(r, c, i)),
      })),
    };
  }
  async setSourceEnabled(actor, libraryId, id, enabled) {
    await this.#ownerAccess(actor, libraryId);
    if (typeof enabled !== "boolean") throw new Error("invalid enabled value");
    if (
      !this.#db
        .prepare("UPDATE knowledge_sources SET enabled=? WHERE id=? AND library_id=?")
        .run(Number(enabled), id, libraryId).changes
    )
      throw new Error("source unavailable");
    return { sourceId: id, enabled };
  }
  async get(actor, libraryId, chunkId) {
    await this.#access(actor, libraryId);
    const [versionId, index] = String(chunkId).split(":");
    if (!/^\d+$/.test(index ?? "")) throw new Error("chunk unavailable");
    const row = this.#db
      .prepare("SELECT * FROM knowledge_versions WHERE id=? AND library_id=?")
      .get(versionId, libraryId);
    const chunk = row && JSON.parse(row.chunks)[Number(index)];
    if (!chunk) throw new Error("chunk unavailable");
    return this.#public(row, chunk, Number(index));
  }
  #public(row, chunk, index) {
    return {
      sourceId: sourceId(row.library_id, row.source),
      enabled: !!this.#db
        .prepare("SELECT enabled FROM knowledge_sources WHERE library_id=? AND source=?")
        .get(row.library_id, row.source)?.enabled,
      citationUrl: `/api/projects/${this.#db.prepare("SELECT project_id FROM knowledge_libraries WHERE id=?").get(row.library_id).project_id}/knowledge-bases/manage?library=${encodeURIComponent(row.library_id)}&chunk=${encodeURIComponent(`${row.id}:${index}`)}`,
      chunkId: `${row.id}:${index}`,
      versionId: row.id,
      libraryId: row.library_id,
      source: row.source,
      title: row.title,
      heading: chunk.heading,
      span: [chunk.start, chunk.end],
      text: chunk.text,
      current: !!row.current,
    };
  }
  async search(actor, libraryIds, query, { topK = 8, mode = "hybrid" } = {}) {
    this.#text(query, "query");
    if (!Array.isArray(libraryIds) || !libraryIds.length)
      throw new Error("explicit library scope is required");
    if (!["lexical", "semantic", "hybrid"].includes(mode)) throw new Error("invalid search mode");
    if (!Number.isInteger(topK) || topK < 1 || topK > 50)
      throw new Error("topK must be between 1 and 50");
    const entries = [];
    for (const id of new Set(libraryIds)) {
      await this.#access(actor, id);
      for (const row of this.#db
        .prepare(
          "SELECT v.* FROM knowledge_versions v JOIN knowledge_sources s ON s.library_id=v.library_id AND s.source=v.source WHERE v.library_id=? AND v.current=1 AND s.enabled=1",
        )
        .all(id)) {
        JSON.parse(row.chunks).forEach((chunk, index) => entries.push({ row, chunk, index }));
      }
    }
    const lexical = bm25(buildIndex(entries.map((e) => e.chunk)), query, { limit: topK * 4 });
    let semantic = [],
      note,
      modeUsed = "lexical";
    if (
      mode !== "lexical" &&
      this.#embedding &&
      entries.some((e) => e.row.embedding === this.#embedding.id)
    ) {
      const [vector] = await this.#embedding.embed([query]);
      if (!Array.isArray(vector) || !vector.length || !vector.every(Number.isFinite))
        throw new Error("invalid query embedding");
      semantic = entries
        .flatMap((e, index) =>
          e.row.embedding === this.#embedding.id && e.chunk.vector?.length === vector.length
            ? [{ index, score: cosine(vector, e.chunk.vector) }]
            : [],
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, topK * 4);
      if (semantic.length) modeUsed = mode;
    }
    if (mode !== "lexical" && modeUsed === "lexical")
      note = "Semantic vectors unavailable for the configured model; used lexical search.";
    for (const id of new Set(libraryIds)) await this.#access(actor, id);
    const ranked =
      modeUsed === "hybrid"
        ? rrfFuse(lexical, semantic, { limit: topK })
        : modeUsed === "semantic"
          ? semantic.slice(0, topK)
          : lexical.slice(0, topK);
    return {
      modeUsed,
      diagnostics: {
        requestedMode: mode,
        libraries: new Set(libraryIds).size,
        sources: new Set(entries.map((e) => `${e.row.library_id}:${e.row.source}`)).size,
        chunks: entries.length,
      },
      note,
      results: ranked
        .filter((hit) => {
          const r = entries[hit.index].row;
          return !!this.#db
            .prepare(
              `SELECT 1 FROM knowledge_versions v JOIN knowledge_sources s ON s.library_id=v.library_id AND s.source=v.source
          WHERE v.id=? AND v.current=1 AND s.enabled=1`,
            )
            .get(r.id);
        })
        .map((hit) => ({
          ...this.#public(
            entries[hit.index].row,
            entries[hit.index].chunk,
            entries[hit.index].index,
          ),
          score: hit.score,
        })),
    };
  }
  /** The host binds actor/session; individual failures are durable and independently retryable. */
  async importBatch(actor, libraryId, items, sessionId = "") {
    await this.#access(actor, libraryId, "contribute");
    if (!Array.isArray(items) || !items.length || items.length > 50)
      throw new Error("batch requires 1 to 50 items");
    if (JSON.stringify(items).length > 8_000_000)
      throw new Error("batch exceeds 8000000 characters");
    const actorKey = actor.kind === "user" ? `user:${actor.userId}` : `agent:${actor.agentId}`;
    const results = [];
    for (const rawItem of items) {
      const item =
        rawItem && typeof rawItem === "object" && !Array.isArray(rawItem)
          ? rawItem
          : { error: "invalid import item" };
      const key = createHash("sha256")
        .update(JSON.stringify(item ?? null))
        .digest("hex");
      const old = this.#db
        .prepare(
          "SELECT * FROM knowledge_import_items WHERE library_id=? AND actor_key=? AND item_key=?",
        )
        .get(libraryId, actorKey, key);
      let reusable = !!old && old.status !== "failed";
      if (reusable && actor.kind === "agent" && old.status === "pending") {
        const candidate = this.#db
          .prepare("SELECT * FROM knowledge_candidates WHERE id=? AND library_id=?")
          .get(JSON.parse(old.result)?.id, libraryId);
        if (candidate?.kind === "import" && candidate.status !== "accepted") {
          const current =
            this.#db
              .prepare(
                "SELECT id FROM knowledge_versions WHERE library_id=? AND source=? AND current=1",
              )
              .get(libraryId, candidate.source)?.id ?? null;
          if (current !== candidate.base_version) reusable = false;
        }
      }
      if (reusable) {
        results.push({
          id: old.id,
          title: old.title,
          source: old.source,
          status:
            old.status === "pending"
              ? (this.#db
                  .prepare("SELECT status FROM knowledge_candidates WHERE id=? AND library_id=?")
                  .get(JSON.parse(old.result)?.id, libraryId)?.status ?? old.status)
              : old.status,
          result: JSON.parse(old.result),
          reused: true,
        });
        continue;
      }
      const id = old?.id ?? randomUUID();
      const title = typeof item?.title === "string" ? item.title.slice(0, 200) : "";
      const source = typeof item?.source === "string" ? item.source.slice(0, 2048) : "";
      let status = "failed",
        error = null,
        result = null;
      try {
        if (!item || typeof item !== "object") throw new Error("invalid import item");
        if (item.error) throw new Error(String(item.error));
        if (
          item.expectedVersion !== undefined &&
          item.expectedVersion !== null &&
          typeof item.expectedVersion !== "string"
        )
          throw new Error("invalid expected version");
        result =
          actor.kind === "user" || this.canImport(actor)
            ? await this.ingest(actor, libraryId, item, true)
            : await this.proposeImport(actor, libraryId, sessionId, item);
        status = result.versionId ? (result.unchanged ? "skipped" : "published") : result.status;
      } catch (e) {
        error = String(e.message ?? e).slice(0, 1000);
      }
      this.#db
        .prepare(
          `INSERT INTO knowledge_import_items(id,library_id,actor_key,item_key,title,source,text,status,error,result,created_at,input) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(library_id,actor_key,item_key) DO UPDATE SET status=excluded.status,error=excluded.error,result=excluded.result`,
        )
        .run(
          id,
          libraryId,
          actorKey,
          key,
          title,
          source,
          typeof item?.text === "string" ? item.text.slice(0, 2_000_000) : "",
          status,
          error,
          JSON.stringify(result),
          new Date().toISOString(),
          JSON.stringify(item ?? {}),
        );
      results.push({ id, title, source, status, error, result });
    }
    return { items: results };
  }
  async imports(actor, libraryId) {
    await this.#ownerAccess(actor, libraryId);
    return this.#db
      .prepare(
        `SELECT i.id,i.title,i.source,i.actor_key,CASE WHEN i.status='pending' THEN COALESCE(c.status,'pending') ELSE i.status END AS status,i.error,i.created_at AS createdAt
         FROM knowledge_import_items i LEFT JOIN knowledge_candidates c ON c.id=json_extract(i.result,'$.id') AND c.library_id=i.library_id
         WHERE i.library_id=? ORDER BY i.rowid DESC LIMIT 200`,
      )
      .all(libraryId)
      .map(({ actor_key, ...row }) => ({
        ...row,
        submittedBy: actor_key,
        canRetry: actor_key === `user:${actor.userId}`,
      }));
  }
  async retryImport(actor, libraryId, id) {
    await this.#ownerAccess(actor, libraryId);
    const row = this.#db
      .prepare("SELECT * FROM knowledge_import_items WHERE id=? AND library_id=?")
      .get(id, libraryId);
    if (!row) throw new Error("import unavailable");
    if (row.actor_key !== `user:${actor.userId}`)
      throw new Error(
        "Only the original submitter can retry this import. Ask the agent to resubmit its source.",
      );
    return this.importBatch(actor, libraryId, [JSON.parse(row.input)]);
  }
  async backup(actor) {
    await this.listManaged(actor);
    return exportSnapshot(this.#db, actor.projectId);
  }
  async restore(actor, backup, agentExists) {
    await this.listManaged(actor);
    return restoreSnapshot(this.#db, actor.projectId, backup, agentExists);
  }

  async proposeImport(actor, libraryId, sessionId, input) {
    for (const field of ["source", "title", "text"]) this.#text(input[field], field);
    if (input.text.length > 2_000_000) throw new Error("text exceeds 2000000 characters");
    input = { ...input, source: sourceAddress(input.source) };
    const baseVersion =
      this.#db
        .prepare("SELECT id FROM knowledge_versions WHERE library_id=? AND source=? AND current=1")
        .get(libraryId, input.source)?.id ?? null;
    const taskId =
      "source-import:" +
      createHash("sha256")
        .update(JSON.stringify([input.source, input.title, input.text, baseVersion]))
        .digest("hex");
    const candidate = await this.#propose(actor, libraryId, {
      kind: "import",
      source: input.source,
      baseVersion,
      taskId,
      sessionId,
      title: input.title,
      conclusion: input.text,
      conditions: "Imported source text; verify the original source before accepting.",
      evidence: [input.source],
    });
    return {
      ...candidate,
      status: this.#db
        .prepare("SELECT status FROM knowledge_candidates WHERE id=? AND library_id=?")
        .get(candidate.id, libraryId).status,
    };
  }
  async propose(actor, libraryId, input) {
    return this.#propose(actor, libraryId, {
      ...input,
      kind: "finding",
      source: null,
      baseVersion: null,
    });
  }
  async #propose(actor, libraryId, input) {
    await this.#access(actor, libraryId, "contribute");
    if (actor.kind !== "agent") throw new Error("agent identity required for proposals");
    for (const key of ["taskId", "sessionId", "title", "conclusion", "conditions"])
      this.#text(
        input[key],
        key,
        key === "title" ? 200 : key === "taskId" || key === "sessionId" ? 512 : 2_000_000,
      );
    if (
      !Array.isArray(input.evidence) ||
      !input.evidence.length ||
      input.evidence.length > 100 ||
      input.evidence.some((e) => typeof e !== "string" || !e.trim() || e.length > 4096)
    )
      throw new Error("evidence references are required");
    const taskKey = JSON.stringify([actor.projectId, actor.agentId, input.sessionId, input.taskId]);
    return this.#transaction(() => {
      // A retry can run in a new extraction Session. Deduplicate by the stable
      // source task ID while retaining the first submitter's trusted Session provenance.
      const existing = this.#db
        .prepare(
          `SELECT id FROM knowledge_candidates WHERE library_id=?
        AND json_extract(task_key,'$[0]')=? AND json_extract(task_key,'$[1]')=?
        AND json_extract(task_key,'$[3]')=?`,
        )
        .get(libraryId, actor.projectId, actor.agentId, input.taskId);
      if (existing) return { id: existing.id, unchanged: true };
      const id = randomUUID();
      this.#db
        .prepare(
          "INSERT INTO knowledge_candidates(id,library_id,task_key,title,conclusion,conditions,evidence,status,reviewed_by,reviewed_at,version_id,kind,source,base_version) VALUES (?,?,?,?,?,?,?,'pending',NULL,NULL,NULL,?,?,?)",
        )
        .run(
          id,
          libraryId,
          taskKey,
          input.title,
          input.conclusion,
          input.conditions,
          JSON.stringify(input.evidence),
          input.kind,
          input.source,
          input.baseVersion,
        );
      return { id };
    });
  }

  async candidates(actor, libraryId) {
    await this.#ownerAccess(actor, libraryId);
    return this.#db
      .prepare("SELECT * FROM knowledge_candidates WHERE library_id=? ORDER BY rowid")
      .all(libraryId)
      .map((row) => ({
        ...row,
        evidence: JSON.parse(row.evidence),
        provenance: JSON.parse(row.task_key),
      }));
  }
  async #ownerAccess(actor, libraryId) {
    if (actor.kind !== "user") throw new Error("human owner identity required");
    await this.#access(actor, libraryId);
  }
  async review(actor, libraryId, id, decision) {
    await this.#ownerAccess(actor, libraryId);
    if (decision === "accept") await this.#access(actor, libraryId, "contribute");
    if (!["accept", "reject"].includes(decision)) throw new Error("invalid review decision");
    return this.#transaction(() => {
      const row = this.#db
        .prepare("SELECT * FROM knowledge_candidates WHERE id=? AND library_id=?")
        .get(id, libraryId);
      if (!row) throw new Error("candidate unavailable");
      if (row.status !== "pending") throw new Error("candidate already reviewed");
      let versionId = null;
      if (decision === "accept") {
        const isImport = row.kind === "import";
        const text = isImport
          ? row.conclusion
          : `${row.conclusion}\n\nApplicable conditions: ${row.conditions}\n\nEvidence:\n${JSON.parse(row.evidence).join("\n")}`;
        versionId = this.#save(
          libraryId,
          {
            source: isImport ? row.source : `trace-candidate://${id}`,
            expectedVersion: isImport ? row.base_version : undefined,
            title: row.title,
            text,
          },
          chunkText(text),
          "",
        ).versionId;
      }
      this.#db
        .prepare(
          "UPDATE knowledge_candidates SET status=?,reviewed_by=?,reviewed_at=?,version_id=? WHERE id=?",
        )
        .run(
          decision === "accept" ? "accepted" : "rejected",
          actor.userId,
          new Date().toISOString(),
          versionId,
          id,
        );
      return { id, status: decision === "accept" ? "accepted" : "rejected", versionId };
    });
  }
}

export function environmentEmbedding(env = process.env) {
  const cfg = embeddingsConfig(env);
  if (!cfg) return null;
  return {
    id: createHash("sha256")
      .update(JSON.stringify([cfg.url, cfg.model, cfg.dimensions]))
      .digest("hex"),
    embed: (texts) => embedTexts(texts, cfg),
  };
}
