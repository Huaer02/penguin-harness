/** Given an explicit import grant and contribution access, requested sources publish without review.
 * Without the grant imports remain pending; findings always remain pending; revocation takes effect.
 * Backup/restore preserves explicit grants, and old backups infer no grants.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { KnowledgeContent } from "../service/content.mjs";
const owner = { kind: "user", userId: "owner", projectId: "p" };
const agent = { kind: "agent", agentId: "writer", projectId: "p" };
test("explicit source publishing leaves autonomous findings pending and respects revocation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "kb-direct-"));
  const db = new KnowledgeContent(path.join(dir, "db"), () => {});
  try {
    const lib = await db.create(owner, "Papers");
    await db.connect(owner, lib.id, "writer", { contribute: true });
    const source = { source: "paper:1", title: "Paper", text: "Penguins live in colonies." };
    assert.equal((await db.importBatch(agent, lib.id, [source], "s")).items[0].status, "pending");
    await db.setImportPermission(owner, "writer", true);
    const next = { ...source, source: "paper:2" };
    assert.equal((await db.importBatch(agent, lib.id, [next], "s")).items[0].status, "published");
    assert.equal((await db.search(agent, [lib.id], "Penguins")).results.length, 1);
    await db.importBatch(agent, lib.id, [next], "s");
    assert.equal((await db.sources(agent, lib.id)).length, 1);
    const finding = await db.propose(agent, lib.id, {
      sessionId: "s",
      taskId: "t",
      title: "Finding",
      conclusion: "New inference",
      conditions: "Test",
      evidence: ["trace://s/t"],
    });
    assert.equal(
      (await db.candidates(owner, lib.id)).find((c) => c.id === finding.id).status,
      "pending",
    );
    const backup = await db.backup(owner);
    const restored = new KnowledgeContent(path.join(dir, "restored"), () => {});
    try {
      await restored.restore(owner, backup, () => true);
      assert.equal(restored.canImport(agent), true);
    } finally {
      restored.close();
    }
    delete backup.tables.knowledge_import_grants;
    const legacy = new KnowledgeContent(path.join(dir, "legacy"), () => {});
    try {
      await legacy.restore(owner, backup, () => true);
      assert.equal(legacy.canImport(agent), false);
    } finally {
      legacy.close();
    }
    await db.updateLibrary(owner, lib.id, { shared: true });
    const future = { ...agent, agentId: "future" };
    assert.equal(db.list(future).length, 1);
    assert.equal((await db.search(future, [lib.id], "Penguins")).results.length, 1);
    await assert.rejects(db.importBatch(future, lib.id, [source], "s"), /unavailable/);
    await db.updateLibrary(owner, lib.id, { shared: false });
    assert.equal(db.list(future).length, 0);
    await db.setImportPermission(owner, "writer", false);
    assert.equal(
      (await db.importBatch(agent, lib.id, [{ ...source, source: "paper:3" }], "s")).items[0]
        .status,
      "pending",
    );
    await db.disconnect(owner, lib.id, "writer");
    await assert.rejects(db.importBatch(agent, lib.id, [source], "s"), /unavailable/);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
