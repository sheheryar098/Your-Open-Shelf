import { DomainError } from "./errors";

/**
 * Fixed-window in-memory rate limiter. Adequate for a single instance; swap for a shared
 * store (e.g. Redis or a Postgres table) when running multiple instances.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const t = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= t) {
    buckets.set(key, { count: 1, resetAt: t + windowMs });
    if (buckets.size > 50_000) sweep(t);
    return true;
  }
  b.count++;
  return b.count <= limit;
}

export function enforceRateLimit(key: string, limit: number, windowMs: number, message?: string) {
  if (process.env.DISABLE_RATE_LIMIT === "true") return;
  if (!rateLimit(key, limit, windowMs)) {
    throw new DomainError(message ?? "Too many attempts. Please wait a few minutes and try again.", "rate_limited");
  }
}

function sweep(t: number) {
  for (const [k, v] of buckets) if (v.resetAt <= t) buckets.delete(k);
}
