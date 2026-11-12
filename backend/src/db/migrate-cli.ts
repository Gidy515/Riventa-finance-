import { database } from "./pool.js";
import { runMigrations } from "./migrate.js";

async function main(): Promise<void> {
  try {
    await runMigrations(database);
  } finally {
    await database.end();
  }
}

main().catch((error: unknown) => {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
});
