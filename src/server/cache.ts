import { query, queryOne } from "./db";
import { now } from "./clock";

/**
 * Cache-aside store in Postgres. Only used in front of slow or
 * rate-limited upstream calls (the ISBN metadata lookup). Hot local reads such as countries
 * and routes are indexed primary-key lookups and are deliberately not cached.
 *
 *  - Keys are versioned (`isbn:v1:…`): bump the version to invalidate a whole namespace.
 *  - Every entry has a TTL with jitter, so a cohort written together doesn't expire together.
 *  - "Not found" is cached briefly (negative caching) so a bad key can't hammer the upstream.
 *  - Errors are never cached.
 *  - Concurrent misses for the same key share one upstream call (single-flight).
 *  - Hits, misses and errors are counted per cache name.
 */

export interface CachePolicy {
  name: string;
  ttlSeconds: number;
  jitterSeconds: number;
  negativeTtlSeconds: number;
}

const inflight = new Map<string, Promise<unknown>>();

async function count(name: string, field: "hits" | "misses" | "errors") {
  await query(
    `INSERT INTO cache_metrics (name, ${field}) VALUES ($1, 1)
         ON CONFLICT (name) DO UPDATE SET ${field} = cache_metrics.${field} + 1`,
    [name],
  );
}

export async function cached<T>(policy: CachePolicy, key: string, compute: () => Promise<T | null>): Promise<T | null> {
  const hit = await queryOne<{ value: T | null }>(
    "SELECT value FROM cache_entries WHERE key = $1 AND expires_at > $2",
    [key, now()],
  );
  if (hit) {
    await count(policy.name, "hits");
    return hit.value;
  }
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T | null>;

  const p = (async () => {
    await count(policy.name, "misses");
    let value: T | null;
    try {
      value = await compute();
    } catch (err) {
      await count(policy.name, "errors");
      throw err;
    }
    const ttl =
      value === null ? policy.negativeTtlSeconds : policy.ttlSeconds + Math.floor(Math.random() * policy.jitterSeconds);
    await query(
      `INSERT INTO cache_entries (key, value, expires_at) VALUES ($1, $2, $3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, created_at = now()`,
      [key, value === null ? null : JSON.stringify(value), new Date(now().getTime() + ttl * 1000)],
    );
    return value;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

export async function invalidate(key: string) {
  await query("DELETE FROM cache_entries WHERE key = $1", [key]);
}

/** Bounded storage: expired rows are purged by a scheduled job. */
export async function purgeExpired(t: Date): Promise<number> {
  return (await query("DELETE FROM cache_entries WHERE expires_at <= $1 RETURNING key", [t])).length;
}

export async function cacheStats() {
  return query<{ name: string; hits: string; misses: string; errors: string; entries: string }>(
    `SELECT m.name, m.hits, m.misses, m.errors,
       (SELECT count(*) FROM cache_entries e WHERE e.key LIKE m.name || ':%') AS entries
       FROM cache_metrics m ORDER BY m.name`,
  );
}
