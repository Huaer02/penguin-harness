import { spawn } from "node:child_process";
/**
 * Given a shared library, connected agents see one persistent resource.
 * Given a private or foreign-project library, guessed IDs do not grant access.
 * Given an existing session identity, revocation takes effect on its next call.
 * Given a model identity or a non-owner user, management cannot mutate resources.
 * Given no creation grant, an Agent cannot create a library or self-authorize.
 * Given a grant, creation persists with only a self connection, and retries do not duplicate.
 * Given a revoked grant or connection, replay cannot restore permission or connection.
 * Given simultaneous owners and multiple connections, writes persist across reopen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { KnowledgeResources } from "../service/resources.mjs";

const owner = { kind: "user", userId: "owner", projectId: "p" };
const agent = (agentId, projectId = "p") => ({ kind: "agent", agentId, projectId });
const authorize = (userId) => {
  if (userId !== "owner") throw new Error("owner required");
};
async function fixture(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "kb-resources-"));
  const filename = path.join(dir, "resources.db");
  const db = new KnowledgeResources(filename, authorize);
  try {
    await run(db, filename);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("connected agents share a resource that survives a new database connection", () =>
  fixture(async (db, filename) => {
    const library = await db.create(owner, "Shared specifications");
    await db.connect(owner, library.id, "a", { contribute: true });
    await db.connect(owner, library.id, "b");
    const second = new KnowledgeResources(filename, authorize);
    try {
      assert.equal(db.list(agent("a"))[0].id, second.list(agent("b"))[0].id);
      assert.equal(second.requireAccess(agent("a"), library.id, "contribute").id, library.id);
      assert.throws(
        () => second.requireAccess(agent("b"), library.id, "contribute"),
        /unavailable/,
      );
    } finally {
      second.close();
    }
  }));

test("private and foreign libraries cannot enter a session scope", () =>
  fixture(async (db) => {
    const library = await db.create(owner, "Private");
    await db.connect(owner, library.id, "a");
    assert.deepEqual(db.list(agent("b")), []);
    assert.throws(() => db.scope(agent("b"), [library.id]), /unavailable/);
    assert.throws(() => db.requireAccess(agent("a", "other-project"), library.id), /unavailable/);
    assert.deepEqual(db.scope(agent("a"), []), []);
  }));

test("revocation applies to the same running identity without deleting the library", () =>
  fixture(async (db) => {
    const library = await db.create(owner, "Long lived");
    const sessionIdentity = agent("a");
    await db.connect(owner, library.id, "a");
    db.requireAccess(sessionIdentity, library.id);
    await db.disconnect(owner, library.id, "a");
    assert.throws(() => db.requireAccess(sessionIdentity, library.id), /unavailable/);
    await db.connect(owner, library.id, "replacement");
    assert.equal(db.list(agent("replacement"))[0].id, library.id);
  }));

test("agents and unauthorized users cannot manage libraries", () =>
  fixture(async (db) => {
    await assert.rejects(db.create(agent("a"), "Forbidden"), /human owner/);
    await assert.rejects(db.create({ ...owner, userId: "member" }, "Forbidden"), /owner required/);
    await assert.rejects(db.create(owner, " "), /name/);
    const library = await db.create(owner, "Allowed");
    await assert.rejects(db.connect(agent("a"), library.id, "a"), /human owner/);
    await assert.rejects(
      db.connect({ ...owner, projectId: "foreign" }, library.id, "a"),
      /unavailable/,
    );
    assert.deepEqual(db.list(agent("a")), []);
  }));

test("concurrent additions and independent connections retain all resources", () =>
  fixture(async (db, filename) => {
    const second = new KnowledgeResources(filename, authorize);
    try {
      const libraries = await Promise.all(
        Array.from({ length: 12 }, (_, i) => (i % 2 ? db : second).create(owner, `Library ${i}`)),
      );
      await Promise.all(libraries.map((l) => db.connect(owner, l.id, "reader")));
      assert.equal(second.list(agent("reader")).length, 12);
    } finally {
      second.close();
    }
  }));

// Separate OS processes contend on the same SQLite file, not only one JS event loop.
test("independent processes preserve all simultaneous library additions", () =>
  fixture(async (db, filename) => {
    const moduleUrl = new URL("../service/resources.mjs", import.meta.url).href;
    const program = `import {KnowledgeResources} from ${JSON.stringify(moduleUrl)};
    const db=new KnowledgeResources(process.argv[1],()=>{});
    try { for(let i=0;i<4;i++){const library=await db.create({kind:"user",projectId:"p",userId:"owner"},process.argv[2]+i);await db.connect({kind:"user",projectId:"p",userId:"owner"},library.id,"reader");} } finally {db.close();}`;
    await Promise.all(
      Array.from(
        { length: 3 },
        (_, i) =>
          new Promise((resolve, reject) => {
            const child = spawn(
              process.execPath,
              ["--input-type=module", "-e", program, filename, String(i)],
              { stdio: ["ignore", "ignore", "pipe"] },
            );
            let error = "";
            child.stderr.on("data", (chunk) => {
              error += chunk;
            });
            child.on("error", reject);
            child.on("close", (code) => (code === 0 ? resolve() : reject(Error(error))));
          }),
      ),
    );
    assert.equal(db.list(agent("reader")).length, 12);
  }));

test("creation grants are owner-managed, isolated by Project and Agent, and default to denied", () =>
  fixture(async (db) => {
    assert.deepEqual(await db.creationPermission(owner, "a"), { allowed: false });
    await assert.rejects(
      db.createForAgent(agent("a"), { name: "New", requestId: "one" }),
      /creation permission required/,
    );
    await assert.rejects(db.setCreationPermission(agent("a"), "a", true), /human owner/);
    await assert.rejects(
      db.setCreationPermission({ ...owner, userId: "member" }, "a", true),
      /owner required/,
    );
    await assert.rejects(db.setCreationPermission(owner, "a", "yes"), /boolean/);
    await db.setCreationPermission(owner, "a", true);
    await assert.rejects(
      db.createForAgent(agent("b"), { name: "New", requestId: "one" }),
      /creation permission required/,
    );
    await assert.rejects(
      db.createForAgent(agent("a", "foreign"), { name: "New", requestId: "one" }),
      /creation permission required/,
    );
    assert.deepEqual(await db.listManaged(owner), []);
  }));

test("authorized creation survives reopen, connects only its creator and safely replays", () =>
  fixture(async (db, filename) => {
    await db.setCreationPermission(owner, "a", true);
    const input = { name: "  Project files  ", requestId: "create-project-files" };
    const result = await db.createForAgent(agent("a"), input);
    assert.equal(result.created, true);
    assert.equal(result.library.name, "Project files");
    assert.equal(result.library.projectId, "p");
    assert.deepEqual(await db.connections(owner, result.library.id), [
      { agentId: "a", contribute: true },
    ]);
    assert.deepEqual(db.list(agent("b")), []);
    const second = new KnowledgeResources(filename, authorize);
    try {
      assert.equal((await second.createForAgent(agent("a"), input)).library.id, result.library.id);
      assert.equal((await second.createForAgent(agent("a"), input)).created, false);
      await assert.rejects(
        second.createForAgent(agent("a"), { ...input, name: "Different" }),
        /already used/,
      );
      await assert.rejects(
        second.createForAgent(agent("a"), { name: "", requestId: "invalid" }),
        /library name/,
      );
      await assert.rejects(
        second.createForAgent(agent("a"), { name: "X", requestId: " " }),
        /request id/,
      );
      await assert.rejects(
        second.createForAgent(agent("a"), { name: "X".repeat(201), requestId: "long" }),
        /library name/,
      );
      assert.equal((await second.listManaged(owner)).length, 1);
      await second.disconnect(owner, result.library.id, "a");
      const replay = await second.createForAgent(agent("a"), input);
      assert.equal(replay.connected, false);
      assert.equal(replay.contribute, false);
      assert.deepEqual(second.list(agent("a")), []);
      await second.setCreationPermission(owner, "a", false);
      await assert.rejects(
        second.createForAgent(agent("a"), input),
        /creation permission required/,
      );
      await assert.rejects(
        second.createForAgent(agent("a"), { name: "Another", requestId: "two" }),
        /creation permission required/,
      );
      assert.equal((await second.listManaged(owner)).length, 1);
    } finally {
      second.close();
    }
  }));
