import { DatabaseSync } from "node:sqlite";
import { column, library } from "./schema.mjs";
import { randomUUID } from "node:crypto";

/**
 * Host-owned resource storage. Keep this database outside agent-writable workspaces.
 * This is not an MCP handler: identities must be supplied by an authenticated host,
 * never constructed from model tool arguments. Project owner policy is supplied by
 * the host, so this layer does not invent a second user/member directory.
 */
export class KnowledgeResources {
  #db;
  #authorizeOwner;
  constructor(filename, authorizeOwner) {
    if (typeof authorizeOwner !== "function") throw new Error("owner authorization is required");
    this.#authorizeOwner = authorizeOwner;
    this.#db = new DatabaseSync(filename);
    this.#db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS knowledge_libraries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        UNIQUE(project_id, id)
      );
      CREATE TABLE IF NOT EXISTS knowledge_connections (
        project_id TEXT NOT NULL,
        library_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        contribution INTEGER NOT NULL CHECK(contribution IN (0, 1)),
        PRIMARY KEY(project_id, library_id, agent_id),
        FOREIGN KEY(project_id, library_id)
          REFERENCES knowledge_libraries(project_id, id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS knowledge_creation_grants (
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        PRIMARY KEY(project_id, agent_id)
      );
      CREATE TABLE IF NOT EXISTS knowledge_import_grants (
        project_id TEXT NOT NULL, agent_id TEXT NOT NULL, granted_by TEXT NOT NULL,
        PRIMARY KEY(project_id, agent_id)
      );
      CREATE TABLE IF NOT EXISTS knowledge_library_creations (
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        requested_name TEXT NOT NULL,
        library_id TEXT NOT NULL,
        PRIMARY KEY(project_id, agent_id, request_id),
        FOREIGN KEY(project_id, library_id)
          REFERENCES knowledge_libraries(project_id, id) ON DELETE CASCADE
      );
    `);
    column(this.#db, "knowledge_libraries", "description", "TEXT NOT NULL DEFAULT ''");
    column(this.#db, "knowledge_libraries", "archived", "INTEGER NOT NULL DEFAULT 0");
    column(this.#db, "knowledge_libraries", "shared", "INTEGER NOT NULL DEFAULT 0");
  }
  close() {
    this.#db.close();
  }
  async #owner(actor) {
    if (!actor || actor.kind !== "user" || !actor.userId || !actor.projectId) {
      throw new Error("human owner identity required");
    }
    await this.#authorizeOwner(actor.userId, actor.projectId);
  }
  async create(actor, name) {
    await this.#owner(actor);
    name = this.#validText(name, "library name");
    const id = randomUUID();
    this.#db
      .prepare("INSERT INTO knowledge_libraries(id,project_id,name) VALUES (?, ?, ?)")
      .run(id, actor.projectId, name.trim());
    return library(this.#library(actor.projectId, id));
  }
  /** A human owner grants only creation, never connection management or publication. */
  async creationPermission(actor, agentId) {
    await this.#owner(actor);
    this.#validText(agentId, "agent id");
    return { allowed: this.#canCreate(actor.projectId, agentId) };
  }
  async setCreationPermission(actor, agentId, allowed) {
    await this.#owner(actor);
    this.#validText(agentId, "agent id");
    if (typeof allowed !== "boolean") throw new Error("allowed must be boolean");
    if (allowed) {
      this.#db
        .prepare(
          `INSERT INTO knowledge_creation_grants VALUES (?,?,?)
        ON CONFLICT(project_id,agent_id) DO UPDATE SET granted_by=excluded.granted_by`,
        )
        .run(actor.projectId, agentId, actor.userId);
    } else {
      this.#db
        .prepare("DELETE FROM knowledge_creation_grants WHERE project_id=? AND agent_id=?")
        .run(actor.projectId, agentId);
    }
    return { allowed };
  }
  async importPermission(actor, agentId) {
    await this.#owner(actor);
    this.#validText(agentId, "agent id");
    return { allowed: this.canImport({ kind: "agent", projectId: actor.projectId, agentId }) };
  }
  async setImportPermission(actor, agentId, allowed) {
    await this.#owner(actor);
    this.#validText(agentId, "agent id");
    if (typeof allowed !== "boolean") throw new Error("allowed must be boolean");
    if (allowed)
      this.#db
        .prepare(
          "INSERT INTO knowledge_import_grants VALUES (?,?,?) ON CONFLICT(project_id,agent_id) DO UPDATE SET granted_by=excluded.granted_by",
        )
        .run(actor.projectId, agentId, actor.userId);
    else
      this.#db
        .prepare("DELETE FROM knowledge_import_grants WHERE project_id=? AND agent_id=?")
        .run(actor.projectId, agentId);
    return { allowed };
  }
  canImport(actor) {
    this.#agent(actor);
    return !!this.#db
      .prepare("SELECT 1 FROM knowledge_import_grants WHERE project_id=? AND agent_id=?")
      .get(actor.projectId, actor.agentId);
  }
  #canCreate(projectId, agentId) {
    return !!this.#db
      .prepare("SELECT 1 FROM knowledge_creation_grants WHERE project_id=? AND agent_id=?")
      .get(projectId, agentId);
  }
  #validText(value, field) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 200)
      throw new Error(`${field} must contain 1 to 200 characters`);
    return value.trim();
  }
  /** Retry identity is scoped to the host-bound Project/Agent, not a model-supplied user. */
  async createForAgent(actor, { name, requestId }) {
    this.#agent(actor);
    name = this.#validText(name, "library name");
    requestId = this.#validText(requestId, "request id");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.#canCreate(actor.projectId, actor.agentId))
        throw new Error(
          "Knowledge creation permission required. Ask the Project owner to enable agent creation in App Center → Knowledge Base.",
        );
      const previous = this.#db
        .prepare(
          `SELECT library_id,requested_name FROM knowledge_library_creations
        WHERE project_id=? AND agent_id=? AND request_id=?`,
        )
        .get(actor.projectId, actor.agentId, requestId);
      let library;
      if (previous) {
        if (previous.requested_name !== name)
          throw new Error("request id already used for a different library name");
        const row = this.#library(actor.projectId, previous.library_id);
        library = {
          id: row.id,
          projectId: row.project_id,
          name: row.name,
          description: row.description,
          archived: !!row.archived,
        };
      } else {
        library = {
          id: randomUUID(),
          projectId: actor.projectId,
          name,
          description: "",
          archived: false,
        };
        this.#db
          .prepare("INSERT INTO knowledge_libraries(id,project_id,name) VALUES (?,?,?)")
          .run(library.id, library.projectId, library.name);
        this.#db
          .prepare("INSERT INTO knowledge_connections VALUES (?,?,?,1)")
          .run(library.projectId, library.id, actor.agentId);
        this.#db
          .prepare("INSERT INTO knowledge_library_creations VALUES (?,?,?,?,?)")
          .run(library.projectId, actor.agentId, requestId, name, library.id);
      }
      // A retry must not restore a connection the owner has explicitly revoked.
      const connection = this.#db
        .prepare(
          `SELECT contribution FROM knowledge_connections
        WHERE project_id=? AND library_id=? AND agent_id=?`,
        )
        .get(actor.projectId, library.id, actor.agentId);
      this.#db.exec("COMMIT");
      return {
        library,
        created: !previous,
        connected: !!connection,
        contribute: !!connection?.contribution,
      };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  async listManaged(actor) {
    await this.#owner(actor);
    return this.#db
      .prepare("SELECT * FROM knowledge_libraries WHERE project_id=? ORDER BY name, id")
      .all(actor.projectId)
      .map(library);
  }
  async updateLibrary(actor, id, patch) {
    await this.#owner(actor);
    const row = this.#library(actor.projectId, id);
    const name = patch.name === undefined ? row.name : this.#validText(patch.name, "library name");
    const description = patch.description ?? row.description;
    if (typeof description !== "string" || description.length > 2000)
      throw new Error("invalid library description");
    if (patch.archived !== undefined && typeof patch.archived !== "boolean")
      throw new Error("invalid archived value");
    if (patch.shared !== undefined && typeof patch.shared !== "boolean")
      throw new Error("invalid shared value");
    this.#db
      .prepare("UPDATE knowledge_libraries SET name=?,description=?,archived=?,shared=? WHERE id=?")
      .run(
        name,
        description,
        patch.archived === undefined ? row.archived : Number(patch.archived),
        patch.shared === undefined ? row.shared : Number(patch.shared),
        id,
      );
    return library(this.#library(actor.projectId, id));
  }
  /** Called by trusted Agent deletion, after runs drain; knowledge and provenance survive. */
  removeAgent(projectId, agentId) {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of [
        "knowledge_connections",
        "knowledge_creation_grants",
        "knowledge_import_grants",
        "knowledge_library_creations",
      ])
        this.#db
          .prepare(`DELETE FROM ${table} WHERE project_id=? AND agent_id=?`)
          .run(projectId, agentId);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }
  async connections(actor, libraryId) {
    await this.#owner(actor);
    this.#library(actor.projectId, libraryId);
    return this.#db
      .prepare(
        "SELECT agent_id, contribution FROM knowledge_connections WHERE project_id=? AND library_id=? ORDER BY agent_id",
      )
      .all(actor.projectId, libraryId)
      .map((row) => ({ agentId: row.agent_id, contribute: !!row.contribution }));
  }
  async connect(actor, libraryId, agentId, { contribute = false } = {}) {
    await this.#owner(actor);
    this.#library(actor.projectId, libraryId);
    if (typeof agentId !== "string" || !agentId.trim()) throw new Error("agent id is required");
    if (typeof contribute !== "boolean") throw new Error("contribute must be boolean");
    this.#db
      .prepare(
        `INSERT INTO knowledge_connections VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, library_id, agent_id)
      DO UPDATE SET contribution=excluded.contribution`,
      )
      .run(actor.projectId, libraryId, agentId, Number(contribute));
  }
  async disconnect(actor, libraryId, agentId) {
    await this.#owner(actor);
    this.#library(actor.projectId, libraryId);
    this.#db
      .prepare(
        `DELETE FROM knowledge_connections
      WHERE project_id=? AND library_id=? AND agent_id=?`,
      )
      .run(actor.projectId, libraryId, agentId);
  }
  #library(projectId, libraryId) {
    const row = this.#db
      .prepare("SELECT * FROM knowledge_libraries WHERE project_id=? AND id=?")
      .get(projectId, libraryId);
    if (!row) throw new Error("knowledge library unavailable");
    return row;
  }
  #agent(actor) {
    if (!actor || actor.kind !== "agent" || !actor.projectId || !actor.agentId) {
      throw new Error("authenticated agent identity required");
    }
  }
  /** Check each operation afresh: disconnects affect already-running sessions too. */
  requireAccess(actor, libraryId, operation = "read") {
    this.#agent(actor);
    if (!["read", "contribute"].includes(operation)) throw new Error("unsupported operation");
    const row = this.#db
      .prepare(
        `SELECT l.*, c.contribution FROM knowledge_libraries l
      LEFT JOIN knowledge_connections c ON c.library_id=l.id AND c.project_id=l.project_id AND c.agent_id=?
      WHERE l.project_id=? AND l.id=? AND (c.agent_id IS NOT NULL OR l.shared=1)`,
      )
      .get(actor.agentId, actor.projectId, libraryId);
    if (!row || row.archived || (operation === "contribute" && !row.contribution)) {
      throw new Error("knowledge library unavailable");
    }
    return {
      ...library(row),
      contribute: !!row.contribution,
      directImport: !!row.contribution && this.canImport(actor),
    };
  }
  list(actor) {
    this.#agent(actor);
    return this.#db
      .prepare(
        `SELECT l.id FROM knowledge_libraries l
      LEFT JOIN knowledge_connections c ON c.library_id=l.id AND c.project_id=l.project_id AND c.agent_id=?
      WHERE l.project_id=? AND (c.agent_id IS NOT NULL OR l.shared=1) AND l.archived=0 ORDER BY l.name, l.id`,
      )
      .all(actor.agentId, actor.projectId)
      .map((row) => this.requireAccess(actor, row.id));
  }
  /** A session scope can narrow access, never expand it; reject the whole invalid scope. */
  scope(actor, libraryIds) {
    if (!Array.isArray(libraryIds)) throw new Error("explicit library scope is required");
    this.#agent(actor);
    return [...new Set(libraryIds)].map((id) => this.requireAccess(actor, id));
  }
}
