interface ColumnInfo {
  name: string;
}

let schemaReady: Promise<void> | undefined;

async function generationColumns(db: D1Database): Promise<Set<string>> {
  const result = await db.prepare("PRAGMA table_info(generations)").all<ColumnInfo>();
  return new Set(result.results.map((column) => column.name));
}

async function ensureColumn(
  db: D1Database,
  column: string,
  ddl: string,
): Promise<void> {
  const before = await generationColumns(db);
  if (before.has(column)) return;
  if (before.size === 0) return;

  try {
    await db.prepare(ddl).run();
  } catch (error) {
    const after = await generationColumns(db);
    if (after.has(column)) return;
    throw error;
  }
}

async function repairRuntimeSchema(db: D1Database): Promise<void> {
  await ensureColumn(
    db,
    "ai_error_code",
    "ALTER TABLE generations ADD COLUMN ai_error_code TEXT",
  );
  await ensureColumn(
    db,
    "photo_mode",
    "ALTER TABLE generations ADD COLUMN photo_mode TEXT NOT NULL DEFAULT 'product'",
  );
  await ensureColumn(
    db,
    "user_prompt",
    "ALTER TABLE generations ADD COLUMN user_prompt TEXT NOT NULL DEFAULT ''",
  );
  await ensureColumn(
    db,
    "task_type",
    "ALTER TABLE generations ADD COLUMN task_type TEXT NOT NULL DEFAULT 'edit_photo'",
  );
}

export async function ensureRuntimeSchema(db: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = repairRuntimeSchema(db).catch((error) => {
      schemaReady = undefined;
      throw error;
    });
  }
  await schemaReady;
}
