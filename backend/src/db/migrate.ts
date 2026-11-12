import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";

const MIGRATIONS_DIRECTORY = resolve(process.cwd(), "migrations");

const LOCK_NAMESPACE = 73194;
const LOCK_ID = 1;

interface MigrationFile {
  filename: string;
  version: string;
}

export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [
      LOCK_NAMESPACE,
      LOCK_ID
    ]);
    lockAcquired = true;

    const files = (await readdir(MIGRATIONS_DIRECTORY))
      .filter((filename) => filename.endsWith(".sql"))
      .sort()
      .map((filename): MigrationFile => {
        const version = filename.slice(0, -4);

        if (!/^\d+_[a-z0-9_]+$/.test(version)) {
          throw new Error(`Invalid migration filename: ${filename}`);
        }

        return { filename, version };
      });

    if (files.length === 0) {
      throw new Error("No SQL migration files were found.");
    }

    for (const migration of files) {
      const tableCheck = await client.query<{ exists: boolean }>(
        "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists"
      );

      const migrationTableExists = tableCheck.rows[0]?.exists ?? false;

      if (migrationTableExists) {
        const applied = await client.query(
          "SELECT 1 FROM schema_migrations WHERE version = $1",
          [migration.version]
        );

        if (applied.rowCount && applied.rowCount > 0) {
          continue;
        }
      }

      const sql = await readFile(
        resolve(MIGRATIONS_DIRECTORY, migration.filename),
        "utf8"
      );

      try {
        await client.query(sql);
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new Error(
          `Migration ${migration.filename} failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      const verification = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [migration.version]
      );

      if (!verification.rowCount) {
        throw new Error(
          `Migration ${migration.filename} completed without recording its version.`
        );
      }

      console.info(`Applied migration: ${migration.version}`);
    }

    console.info("Database migrations are up to date.");
  } finally {
    if (lockAcquired) {
      await client
        .query("SELECT pg_advisory_unlock($1, $2)", [
          LOCK_NAMESPACE,
          LOCK_ID
        ])
        .catch(() => undefined);
    }

    client.release();
  }
}
