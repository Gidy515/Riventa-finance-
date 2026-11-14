import {
  Pool,
  type PoolClient,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import { config } from "../config.js";

export const database = new Pool({
  ...config.database,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: true }
      : undefined,
});

database.on("error", (error: Error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return database.query<T>(text, values);
}

export async function withTransaction<T>(
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await database.connect();

  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
