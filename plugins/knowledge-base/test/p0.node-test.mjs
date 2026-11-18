/**
 * - Owners rename/archive libraries and disable sources without losing historical evidence.
 * - Mixed imports persist per-item failures; retries preserve successful items and version checks.
 * - Stale candidates cannot replace newer sources, and task IDs cannot forge candidate kinds.
 * - A Project snapshot restores history, candidates and valid connections atomically in a fresh store.
 * - Invalid/foreign backups and nonempty targets never partially restore data.
 * - Agent deletion removes capabilities/connections without removing Project knowledge.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chunkText } from "../mcp/lib/chunk.mjs";
import { KnowledgeContent } from "../service/content.mjs";
const owner = { kind: "user", userId: "owner", projectId: "p" };
const writer = { kind: "agent", agentId: "writer", projectId: "p" };
const reader = { kind: "agent", agentId: "reader", projectId: "p" };
const auth = (u) => {
  if (u !== "owner") throw new Error("owner required");
};
async function fixture(run, embedding = null) {
  const root = await mkdtemp(path.join(tmpdir(), "kb-p0-"));
  const db = new KnowledgeContent(path.join(root, "source.db"), auth, embedding);
  try {
    const l = await db.create(owner, "Original");
    await db.connect(owner, l.id, "writer", { contribute: true });
    await db.connect(owner, l.id, "reader");
    await run(db, l.id, root);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}
const text = {
  source: "file:///docs/guide.md",
  title: "Guide",
  text: "kb-p0-token Node 24 is required.",
};
test("archive and disable preserve history while excluding new Agent use", () =>
  fixture(async (db, id) => {
    await db.ingest(owner, id, text);
    const hit = (await db.search(reader, [id], "kb-p0-token")).results[0];
    assert.ok(hit.sourceId);
    assert.match(hit.citationUrl, /manage\?library=/);
    const renamed = await db.updateLibrary(owner, id, {
      name: "New name",
      description: "Shared technical references",
    });
    assert.equal(renamed.name, "New name");
    await assert.rejects(db.updateLibrary(reader, id, { archived: true }), /human owner/);
    await db.setSourceEnabled(owner, id, hit.sourceId, false);
    assert.equal((await db.search(reader, [id], "kb-p0-token")).results.length, 0);
    assert.equal((await db.get(reader, id, hit.chunkId)).enabled, false);
    assert.equal((await db.document(reader, id, hit.sourceId)).versions[0].text, text.text);
    await assert.rejects(db.setSourceEnabled(reader, id, hit.sourceId, true), /human owner/);
    await db.setSourceEnabled(owner, id, hit.sourceId, true);
    assert.equal((await db.search(reader, [id], "kb-p0-token")).results.length, 1);
    await db.updateLibrary(owner, id, { archived: true });
    assert.deepEqual(db.list(reader), []);
    await assert.rejects(db.search(reader, [id], "kb-p0-token"), /unavailable/);
    await assert.rejects(db.ingest(owner, id, { ...text, text: "changed" }), /archived/);
    assert.equal((await db.document(owner, id, hit.sourceId)).versions.length, 1);
    await db.updateLibrary(owner, id, { archived: false });
    assert.equal(db.list(reader).length, 1);
  }));
test("mixed batches persist outcomes, keep distinct paths, and refuse implicit source replacement", () =>
  fixture(async (db, id) => {
    const a = { ...text, source: "file:///one/same.md", expectedVersion: null },
      b = { ...text, source: "file:///two/same.md", expectedVersion: null };
    const batch = await db.importBatch(owner, id, [
      a,
      b,
      { source: "file:///bad.md", title: "Bad", text: "" },
      null,
    ]);
    assert.deepEqual(
      batch.items.map((i) => i.status),
      ["published", "published", "failed", "failed"],
    );
    const repeat = await db.importBatch(owner, id, [a, b]);
    assert.deepEqual(
      repeat.items.map((i) => i.id),
      batch.items.slice(0, 2).map((i) => i.id),
    );
    assert.equal((await db.sources(reader, id)).length, 2);
    const [source] = await db.sources(reader, id);
    const changed = await db.importBatch(owner, id, [
      { ...a, text: "Changed without explicit update" },
    ]);
    assert.equal(changed.items[0].status, "failed");
    assert.match(changed.items[0].error, /version conflict/);
    await db.ingest(owner, id, {
      ...a,
      text: "Explicit update",
      expectedVersion: source.versionId,
    });
    const doc = await db.document(reader, id, source.sourceId);
    assert.equal(doc.versions.length, 2);
    assert.equal(doc.versions[0].text, "Explicit update");
    const retried = await db.retryImport(owner, id, changed.items[0].id);
    assert.equal(retried.items[0].status, "failed");
    assert.equal(
      (await db.document(reader, id, source.sourceId)).versions[0].text,
      "Explicit update",
    );
    assert.ok((await db.imports(owner, id)).some((i) => i.status === "failed"));
    await assert.rejects(db.importBatch(reader, id, [a]), /unavailable/);
  }));
test("a transient embedding failure can be retried without duplicating a source", async () => {
  let failed = true;
  let calls = 0;
  await fixture(
    async (db, id) => {
      const batch = await db.importBatch(owner, id, [{ ...text, expectedVersion: null }]);
      assert.equal(batch.items[0].status, "failed");
      failed = false;
      const retry = await db.retryImport(owner, id, batch.items[0].id);
      assert.equal(retry.items[0].status, "published");
      assert.equal(retry.items[0].id, batch.items[0].id);
      assert.equal((await db.sources(reader, id)).length, 1);
      assert.equal((await db.imports(owner, id))[0].status, "published");
      const before = calls;
      assert.equal((await db.ingest(owner, id, text)).unchanged, true);
      assert.equal(calls, before);
    },
    {
      id: "test",
      embed: async (texts) => {
        calls++;
        if (failed) throw new Error("embedding temporarily unavailable");
        return texts.map(() => [1, 0]);
      },
    },
  );
});
test("stale candidate review conflicts and caller task prefixes cannot turn findings into imports", () =>
  fixture(async (db, id, root) => {
    await db.ingest(owner, id, text);
    const batch = await db.importBatch(
      writer,
      id,
      [{ ...text, text: "old proposed update" }],
      "session",
    );
    const candidate = batch.items[0].result.id;
    assert.equal(batch.items[0].status, "pending");
    await db.ingest(owner, id, { ...text, text: "newer human update" });
    await assert.rejects(db.review(owner, id, candidate, "accept"), /version conflict/);
    assert.equal((await db.candidates(owner, id))[0].status, "pending");
    const fresh = await db.importBatch(
      writer,
      id,
      [{ ...text, text: "old proposed update" }],
      "new-session",
    );
    assert.notEqual(fresh.items[0].result.id, candidate);

    const finding = await db.propose(writer, id, {
      taskId: "source-import:forged",
      sessionId: "s",
      title: "Finding",
      conclusion: "A finding",
      conditions: "Test only",
      evidence: [text.source],
    });
    const reopened = new KnowledgeContent(path.join(root, "source.db"), auth);
    try {
      assert.equal(
        (await reopened.candidates(owner, id)).find((c) => c.id === finding.id).kind,
        "finding",
      );
      await reopened.review(owner, id, finding.id, "accept");
      assert.ok(
        (await reopened.sources(reader, id)).some(
          (s) => s.source === `trace-candidate://${finding.id}`,
        ),
      );
    } finally {
      reopened.close();
    }
  }));
test("backups restore versions, candidates and valid permissions into an empty knowledge area", () =>
  fixture(async (db, id, root) => {
    await db.ingest(owner, id, text);
    const old = (await db.search(reader, [id], "kb-p0-token")).results[0];
    await db.ingest(owner, id, { ...text, text: "kb-p0-token updated Node 25" });
    await db.setSourceEnabled(owner, id, old.sourceId, false);
    await db.setCreationPermission(owner, "writer", true);
    await db.importBatch(
      writer,
      id,
      [{ ...text, source: "file:///pending.md" }],
      "original-session",
    );
    await db.importBatch(owner, id, [{ ...text, source: "file:///failed.md", text: "" }]);
    const snapshot = JSON.parse(JSON.stringify(await db.backup(owner)));
    const restored = new KnowledgeContent(path.join(root, "restored.db"), auth);
    try {
      const result = await restored.restore(owner, snapshot, (agent) => agent === "writer");
      assert.equal(result.libraries, 1);
      assert.ok(result.skippedAgentRows > 0);
      assert.equal((await restored.get(writer, id, old.chunkId)).text, text.text);
      assert.equal((await restored.get(writer, id, old.chunkId)).current, false);
      assert.equal((await restored.sources(writer, id))[0].enabled, false);
      assert.equal((await restored.candidates(owner, id))[0].status, "pending");
      assert.equal((await restored.imports(owner, id)).length, 2);
      assert.deepEqual(await restored.creationPermission(owner, "writer"), { allowed: true });
      assert.deepEqual(restored.list(reader), []);
      assert.equal((await restored.document(writer, id, old.sourceId)).versions.length, 2);
      await restored.setSourceEnabled(owner, id, old.sourceId, true);
      assert.match((await restored.search(writer, [id], "kb-p0-token")).results[0].text, /Node 25/);
      await assert.rejects(
        restored.restore(owner, snapshot, () => true),
        /empty Project/,
      );
    } finally {
      restored.close();
    }
    await assert.rejects(db.backup(reader), /human owner/);
  }));
test("invalid and foreign backups roll back all data rather than partially restoring", () =>
  fixture(async (db, id, root) => {
    await db.ingest(owner, id, text);
    await db.importBatch(
      writer,
      id,
      [{ ...text, source: "file:///pending-security.md" }],
      "snapshot",
    );
    const snapshot = JSON.parse(JSON.stringify(await db.backup(owner)));
    const target = new KnowledgeContent(path.join(root, "invalid.db"), auth);
    try {
      await assert.rejects(
        target.restore(owner, { ...snapshot, projectId: "foreign" }, () => true),
        /invalid knowledge backup/,
      );
      const bad = structuredClone(snapshot);
      bad.tables.knowledge_versions[0].library_id = "foreign";
      await assert.rejects(
        target.restore(owner, bad, () => true),
        /invalid knowledge backup/,
      );
      const conflict = structuredClone(snapshot);
      conflict.tables.knowledge_versions.push({
        ...conflict.tables.knowledge_versions[0],
        id: "extra-current",
      });
      await assert.rejects(
        target.restore(owner, conflict, () => true),
        /invalid knowledge backup/,
      );
      const reference = structuredClone(snapshot);
      reference.tables.knowledge_import_items[0].result = JSON.stringify({
        id: "foreign-candidate",
      });
      await assert.rejects(
        target.restore(owner, reference, () => true),
        /invalid knowledge backup/,
      );
      assert.deepEqual(await target.listManaged(owner), []);
      await target.restore(owner, snapshot, () => true);
      assert.equal((await target.sources(reader, id)).length, 1);
    } finally {
      target.close();
    }
  }));
test("Agent removal drops its connections and creation grants but keeps libraries and evidence", () =>
  fixture(async (db, id) => {
    await db.ingest(owner, id, text);
    await db.setCreationPermission(owner, "writer", true);
    db.removeAgent("p", "writer");
    assert.deepEqual(db.list(writer), []);
    assert.deepEqual(await db.creationPermission(owner, "writer"), { allowed: false });
    assert.equal((await db.sources(reader, id)).length, 1);
    assert.equal((await db.listManaged(owner)).length, 1);
  }));

test("pre-upgrade source snapshots remain readable with stable chunk identifiers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kb-legacy-"));
  let db;
  try {
    const filename = path.join(root, "legacy.db");
    db = new KnowledgeContent(filename, auth);
    const library = await db.create(owner, "Legacy");
    db.close();
    db = null;
    const legacy = new DatabaseSync(filename);
    legacy.exec(
      "DROP TABLE knowledge_sources; DROP TABLE knowledge_candidates; DROP TABLE knowledge_versions;",
    );
    legacy.exec(`CREATE TABLE knowledge_versions (id TEXT PRIMARY KEY,library_id TEXT NOT NULL REFERENCES knowledge_libraries(id),source TEXT NOT NULL,title TEXT NOT NULL,hash TEXT NOT NULL,body TEXT NOT NULL,chunks TEXT NOT NULL,embedding TEXT NOT NULL,current INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE knowledge_candidates (id TEXT PRIMARY KEY,library_id TEXT NOT NULL,task_key TEXT NOT NULL,title TEXT NOT NULL,conclusion TEXT NOT NULL,conditions TEXT NOT NULL,evidence TEXT NOT NULL,status TEXT NOT NULL,reviewed_by TEXT,reviewed_at TEXT,version_id TEXT,UNIQUE(library_id,task_key));`);
    legacy
      .prepare("INSERT INTO knowledge_versions VALUES (?,?,?,?,?,?,?,?,1,?)")
      .run(
        "old-version",
        library.id,
        text.source,
        text.title,
        "legacy-hash",
        text.text,
        JSON.stringify(chunkText(text.text)),
        "",
        "2026-11-01T00:00:00.000Z",
      );
    legacy.close();
    db = new KnowledgeContent(filename, auth);
    assert.equal((await db.get(owner, library.id, "old-version:0")).text, text.text);
    const sources = await db.sources(owner, library.id);
    assert.equal(sources[0].enabled, true);
    await db.setSourceEnabled(owner, library.id, sources[0].sourceId, false);
    db.close();
    db = new KnowledgeContent(filename, auth);
    assert.equal((await db.sources(owner, library.id))[0].enabled, false);
  } finally {
    db?.close();
    await rm(root, { recursive: true, force: true });
  }
});
