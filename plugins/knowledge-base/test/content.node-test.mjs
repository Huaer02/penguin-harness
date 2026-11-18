/**
 * Version updates retain old citation evidence and same content skips duplicates.
 * Hybrid retrieval finds paraphrases and refuses unauthorized library scopes.
 * Pending proposals stay invisible; human acceptance publishes to another connected agent.
 * Rejected proposals stay invisible and stale review attempts fail.
 * Repeated task extraction is idempotent and survives reopening storage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { KnowledgeContent } from "../service/content.mjs";
const owner = { kind: "user", userId: "owner", projectId: "p" };
const writer = { kind: "agent", agentId: "writer", projectId: "p" };
const reader = { kind: "agent", agentId: "reader", projectId: "p" };
const authorize = (u) => {
  if (u !== "owner") throw new Error("owner required");
};
async function fixture(run, embedding = null) {
  const root = await mkdtemp(path.join(tmpdir(), "kb-content-"));
  const filename = path.join(root, "kb.db");
  const db = new KnowledgeContent(filename, authorize, embedding);
  try {
    const library = await db.create(owner, "Shared");
    await db.connect(owner, library.id, writer.agentId, { contribute: true });
    await db.connect(owner, library.id, reader.agentId);
    await run(db, library.id, filename);
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}
const proposal = {
  sessionId: "session",
  taskId: "task",
  title: "Build finding",
  conclusion: "The project requires Node 24 for compilation.",
  conditions: "Repository version X on macOS.",
  evidence: ["trace://session/request-4/tool-result-2"],
};
test("updates retain immutable citation evidence and repeated content is unchanged", () =>
  fixture(async (db, id) => {
    const source = {
      source: "file:///guide.md",
      title: "Guide",
      text: "# Runtime\nNode 23 is required.",
    };
    const first = await db.ingest(writer, id, source);
    assert.equal((await db.ingest(writer, id, source)).unchanged, true);
    const hit = (await db.search(reader, [id], "Node")).results[0];
    await db.ingest(writer, id, { ...source, text: "# Runtime\nNode 24 is required." });
    assert.match((await db.get(reader, id, hit.chunkId)).text, /Node 23/);
    assert.equal((await db.get(reader, id, hit.chunkId)).current, false);
    assert.match((await db.search(reader, [id], "Node")).results[0].text, /Node 24/);
    assert.equal((await db.sources(reader, id)).length, 1);
    assert.ok(first.versionId);
  }));
test("hybrid search retrieves paraphrases and rejects expanded scopes", () =>
  fixture(
    async (db, id) => {
      await db.ingest(writer, id, {
        source: "birds",
        title: "Birds",
        text: "Penguins are flightless birds.",
      });
      await db.ingest(writer, id, {
        source: "runtime",
        title: "Runtime",
        text: "Compile JavaScript with Node.",
      });
      const hits = await db.search(reader, [id], "avian");
      assert.equal(hits.modeUsed, "hybrid");
      assert.equal(hits.results[0].source, "birds");
      assert.equal((await db.search(reader, [id], "avian", { mode: "lexical" })).results.length, 0);
      const privateLib = await db.create(owner, "Private");
      await assert.rejects(db.search(reader, [id, privateLib.id], "avian"), /unavailable/);
      await assert.rejects(
        db.ingest(reader, id, { source: "x", title: "x", text: "x" }),
        /unavailable/,
      );
    },
    {
      id: "fake-model-v1",
      embed: async (texts) => texts.map((t) => (/penguin|avian/i.test(t) ? [1, 0] : [0, 1])),
    },
  ));
test("pending findings stay hidden until human approval and then another agent can retrieve", () =>
  fixture(async (db, id) => {
    const candidate = await db.propose(writer, id, proposal);
    assert.equal((await db.search(reader, [id], "compilation")).results.length, 0);
    await assert.rejects(db.review(writer, id, candidate.id, "accept"), /human owner/);
    const result = await db.review(owner, id, candidate.id, "accept");
    assert.equal(result.status, "accepted");
    const hit = (await db.search(reader, [id], "compilation")).results[0];
    assert.match(hit.text, /Node 24/);
    assert.match(hit.text, /tool-result-2/);
    assert.equal((await db.candidates(owner, id))[0].reviewed_by, "owner");
    await assert.rejects(db.review(owner, id, candidate.id, "reject"), /already reviewed/);
  }));
test("rejected findings cannot be searched or approved later", () =>
  fixture(async (db, id) => {
    const candidate = await db.propose(writer, id, proposal);
    await db.review(owner, id, candidate.id, "reject");
    assert.equal((await db.search(reader, [id], "Node")).results.length, 0);
    await assert.rejects(db.review(owner, id, candidate.id, "accept"), /already reviewed/);
  }));
test("repeated task proposals are idempotent and pending state survives reopen", () =>
  fixture(async (db, id, filename) => {
    const first = await db.propose(writer, id, proposal),
      second = await db.propose(writer, id, proposal);
    assert.equal(first.id, second.id);
    assert.equal(
      (await db.propose(writer, id, { ...proposal, sessionId: "retry-extraction" })).id,
      first.id,
    );
    const reopened = new KnowledgeContent(filename, authorize);
    try {
      const pending = await reopened.candidates(owner, id);
      assert.equal(pending.length, 1);
      assert.equal(pending[0].status, "pending");
      assert.deepEqual(pending[0].provenance, ["p", "writer", "session", "task"]);
    } finally {
      reopened.close();
    }
  }));

test("agent source imports stay pending and acceptance preserves their original source", () =>
  fixture(async (db, id) => {
    const input = {
      source: "file:///handbook.md",
      title: "Handbook",
      text: "Release requires approval.",
    };
    const candidate = await db.proposeImport(writer, id, "session", input);
    assert.equal((await db.search(reader, [id], "Release")).results.length, 0);
    await db.review(owner, id, candidate.id, "accept");
    const hit = (await db.search(reader, [id], "Release")).results[0];
    assert.equal(hit.source, input.source);
    assert.equal(hit.text, input.text);
  }));
