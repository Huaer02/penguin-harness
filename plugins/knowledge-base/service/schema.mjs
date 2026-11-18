/** Additive migration: old databases remain readable; authored SQL identifiers only. */
export function column(db, table, name, definition) {
  if (
    !db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((c) => c.name === name)
  ) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    } catch (error) {
      // Other processes may have completed the same additive migration while we waited.
      if (
        !db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((c) => c.name === name)
      )
        throw error;
    }
  }
}
export function library(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description ?? "",
    archived: !!row.archived,
    shared: !!row.shared,
  };
}
