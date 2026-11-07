import { Pool, type PoolClient, type QueryResultRow } from "pg";

type Queryable = Pool | PoolClient;
export type Db = Queryable;

const g = globalThis as unknown as { __yosPool?: Pool };

export function pool(): Pool {
  if (!g.__yosPool) {
    g.__yosPool = new Pool({
      connectionString: process.env.DATABASE_URL ?? "postgres://yos:yos@localhost:5432/yos",
      max: Number(process.env.DB_POOL_MAX ?? 10),
    });
  }
  return g.__yosPool;
}

export async function closePool() {
  if (g.__yosPool) {
    await g.__yosPool.end();
    g.__yosPool = undefined;
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Queryable = pool(),
): Promise<T[]> {
  const res = await db.query<T>(sql, params as unknown[]);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
  db: Queryable = pool(),
): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

const RETRYABLE = new Set(["40001", "40P01"]); // serialization failure, deadlock

/**
 * Run `fn` inside a database transaction. Retries on serialization failures and
 * deadlocks so callers can rely on row locks for concurrency safety.
 */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      const code = (err as { code?: string }).code;
      if (code && RETRYABLE.has(code) && attempt < attempts) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
}
