import { DomainError } from "./errors";

/**
 * Fixed-window in-memory rate limiter. Adequate for a single instance; swap for a shared
 * store (e.g. Redis or a Postgres table) when running multiple instances.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets; use for the Retry-After header. */
  retryAfter: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  if (process.env.DISABLE_RATE_LIMIT === "true") return { ok: true, retryAfter: 0 };
  const t = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= t) {
    buckets.set(key, { count: 1, resetAt: t + windowMs });
    if (buckets.size > 50_000) sweep(t);
    return { ok: true, retryAfter: 0 };
  }
  b.count++;
  return { ok: b.count <= limit, retryAfter: Math.max(1, Math.ceil((b.resetAt - t) / 1000)) };
}

export class RateLimitedError extends DomainError {
  constructor(message: string, public retryAfter: number) {
    super(message, "rate_limited");
  }
}

export function enforceRateLimit(key: string, limit: number, windowMs: number, message?: string) {
  const r = rateLimit(key, limit, windowMs);
  if (!r.ok) {
    throw new RateLimitedError(message ?? "Too many attempts. Please wait a few minutes and try again.", r.retryAfter);
  }
}

function sweep(t: number) {
  for (const [k, v] of buckets) if (v.resetAt <= t) buckets.delete(k);
}
