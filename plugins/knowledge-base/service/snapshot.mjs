import { sourceId } from "./source.mjs";
/** Versioned Project backup. No SQL, filesystem paths or credentials are accepted from the file. */
const projectTables = [
  "knowledge_libraries",
  "knowledge_connections",
  "knowledge_creation_grants",
  "knowledge_import_grants",
  "knowledge_library_creations",
];
const contentTables = [
  "knowledge_versions",
  "knowledge_sources",
  "knowledge_candidates",
  "knowledge_import_items",
];
const tables = [...projectTables, ...contentTables];
export function exportSnapshot(db, projectId) {
  db.exec("BEGIN");
  try {
    const data = {};
    for (const table of tables)
      data[table] = db
        .prepare(
          projectTables.includes(table)
            ? `SELECT * FROM ${table} WHERE project_id=?`
            : `SELECT * FROM ${table} WHERE library_id IN (SELECT id FROM knowledge_libraries WHERE project_id=?)`,
        )
        .all(projectId);
    db.exec("COMMIT");
    return {
      format: "penguin-knowledge-backup",
      version: 1,
      projectId,
      createdAt: new Date().toISOString(),
      tables: data,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function restoreSnapshot(db, projectId, input, agentExists) {
  const invalid = () => {
    throw new Error("invalid knowledge backup");
  };
  if (
    !input ||
    input.format !== "penguin-knowledge-backup" ||
    input.version !== 1 ||
    input.projectId !== projectId ||
    !input.tables
  )
    invalid();
  if (JSON.stringify(input).length > 18_000_000) invalid();
  // Pre-import-permission backups have no grants; never infer new publishing rights.
  const data = {
    ...input.tables,
    knowledge_import_grants: input.tables.knowledge_import_grants ?? [],
  };
  data.knowledge_libraries = data.knowledge_libraries?.map((row) => ({ shared: 0, ...row }));
  const ids = new Set();
  for (const table of tables) {
    if (!Array.isArray(data[table])) invalid();
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    for (const row of data[table]) {
      if (
        !row ||
        typeof row !== "object" ||
        Array.isArray(row) ||
        Object.keys(row).length !== columns.length
      )
        invalid();
      for (const col of columns) {
        const v = row[col.name];
        if (v === undefined || (v === null && (col.notnull || col.pk))) invalid();
        if (
          v !== null &&
          (col.type === "INTEGER" ? !Number.isSafeInteger(v) : typeof v !== "string")
        )
          invalid();
      }
      if (projectTables.includes(table) && row.project_id !== projectId) invalid();
      if (table === "knowledge_libraries") {
        if (
          !row.id ||
          !row.name.trim() ||
          row.name.length > 200 ||
          row.description.length > 2000 ||
          ![0, 1].includes(row.archived) ||
          ![0, 1].includes(row.shared)
        )
          invalid();
        ids.add(row.id);
      }
    }
  }
  const versions = new Map(data.knowledge_versions.map((r) => [r.id, r.library_id]));
  for (const table of [...contentTables, "knowledge_connections", "knowledge_library_creations"])
    for (const row of data[table]) if (!ids.has(row.library_id)) invalid();
  for (const row of data.knowledge_versions) {
    let chunks;
    try {
      chunks = JSON.parse(row.chunks);
    } catch {
      invalid();
    }
    if (
      !row.source ||
      !row.title ||
      !row.body ||
      row.body.length > 2_000_000 ||
      ![0, 1].includes(row.current) ||
      !Array.isArray(chunks)
    )
      invalid();
    for (const c of chunks)
      if (
        typeof c.text !== "string" ||
        !Number.isInteger(c.start) ||
        !Number.isInteger(c.end) ||
        c.start < 0 ||
        c.end < c.start ||
        c.end > row.body.length ||
        (c.vector !== undefined && (!Array.isArray(c.vector) || !c.vector.every(Number.isFinite)))
      )
        invalid();
  }
  for (const row of data.knowledge_sources)
    if (
      !row.source ||
      row.id !== sourceId(row.library_id, row.source) ||
      ![0, 1].includes(row.enabled)
    )
      invalid();
  for (const row of data.knowledge_connections) if (![0, 1].includes(row.contribution)) invalid();
  for (const row of data.knowledge_candidates) {
    let evidence, task;
    try {
      evidence = JSON.parse(row.evidence);
      task = JSON.parse(row.task_key);
    } catch {
      invalid();
    }
    if (
      !Array.isArray(evidence) ||
      !evidence.every((e) => typeof e === "string") ||
      !Array.isArray(task) ||
      task.length !== 4 ||
      task[0] !== projectId ||
      !task.every((t) => typeof t === "string") ||
      !["pending", "accepted", "rejected"].includes(row.status) ||
      !["import", "finding"].includes(row.kind)
    )
      invalid();
    if (row.kind === "import" && (typeof row.source !== "string" || !row.source)) invalid();
    if (row.base_version !== null && versions.get(row.base_version) !== row.library_id) invalid();
    if (row.version_id !== null && versions.get(row.version_id) !== row.library_id) invalid();
  }
  const candidates = new Map(data.knowledge_candidates.map((r) => [r.id, r.library_id]));
  for (const row of data.knowledge_import_items) {
    let input, result;
    try {
      input = JSON.parse(row.input);
      result = JSON.parse(row.result);
    } catch {
      invalid();
    }
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      !["failed", "published", "skipped", "pending", "accepted", "rejected"].includes(row.status) ||
      row.text.length > 2_000_000 ||
      row.title.length > 200 ||
      row.source.length > 2048
    )
      invalid();
    if (result !== null && (typeof result !== "object" || Array.isArray(result))) invalid();
    if (
      ["pending", "accepted", "rejected"].includes(row.status) &&
      candidates.get(result?.id) !== row.library_id
    )
      invalid();
    if (
      ["published", "skipped"].includes(row.status) &&
      versions.get(result?.versionId) !== row.library_id
    )
      invalid();
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      db.prepare("SELECT 1 FROM knowledge_libraries WHERE project_id=?").get(projectId) ||
      db.prepare("SELECT 1 FROM knowledge_creation_grants WHERE project_id=?").get(projectId) ||
      db.prepare("SELECT 1 FROM knowledge_import_grants WHERE project_id=?").get(projectId)
    )
      throw new Error(
        "restore requires an empty Project knowledge area (no libraries or creation grants)",
      );
    let skippedAgentRows = 0;
    // Parents before dependent rows; one transaction prevents partial recovery.
    for (const table of [
      "knowledge_libraries",
      "knowledge_sources",
      "knowledge_versions",
      "knowledge_candidates",
      "knowledge_import_items",
      "knowledge_connections",
      "knowledge_creation_grants",
      "knowledge_import_grants",
      "knowledge_library_creations",
    ]) {
      const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name);
      const insert = db.prepare(
        `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
      );
      for (const row of data[table]) {
        if (
          [
            "knowledge_connections",
            "knowledge_creation_grants",
            "knowledge_import_grants",
            "knowledge_library_creations",
          ].includes(table) &&
          !agentExists(row.agent_id)
        ) {
          skippedAgentRows++;
          continue;
        }
        insert.run(...columns.map((c) => row[c]));
      }
    }
    // The snapshot must have precisely one current version per source and complete source metadata.
    if (
      db
        .prepare(
          `SELECT 1 FROM knowledge_versions v WHERE v.library_id IN (SELECT id FROM knowledge_libraries WHERE project_id=?)
      GROUP BY library_id,source HAVING SUM(current)<>1`,
        )
        .get(projectId)
    )
      invalid();
    if (
      db
        .prepare(
          `SELECT 1 FROM knowledge_versions v WHERE v.library_id IN (SELECT id FROM knowledge_libraries WHERE project_id=?) AND NOT EXISTS
      (SELECT 1 FROM knowledge_sources s WHERE s.library_id=v.library_id AND s.source=v.source)`,
        )
        .get(projectId)
    )
      invalid();
    db.exec("COMMIT");
    return {
      libraries: data.knowledge_libraries.length,
      versions: data.knowledge_versions.length,
      skippedAgentRows,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    if (String(error.code ?? "").startsWith("ERR_SQLITE"))
      throw new Error("backup identity conflict");
    throw error;
  }
}
