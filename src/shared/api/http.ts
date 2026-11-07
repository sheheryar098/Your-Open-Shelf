import "server-only";
import { NextResponse } from "next/server";
import { DomainError } from "@/server/errors";
import { RateLimitedError } from "@/server/rate-limit";

/**
 * Response helpers for route handlers. Every error uses the same RFC 9457 problem-details
 * shape so clients can branch on `type` and `status`.
 */
const TYPE_BASE = "https://yos.example/errors/";

export type ProblemType =
  | "unauthenticated"
  | "forbidden"
  | "not-found"
  | "validation"
  | "conflict"
  | "rate-limited"
  | "not-configured"
  | "unavailable"
  | "internal";

const STATUS: Record<ProblemType, number> = {
  unauthenticated: 401,
  forbidden: 403,
  "not-found": 404,
  validation: 422,
  conflict: 409,
  "rate-limited": 429,
  "not-configured": 503,
  unavailable: 503,
  internal: 500,
};

const TITLE: Record<ProblemType, string> = {
  unauthenticated: "Authentication required",
  forbidden: "Not allowed",
  "not-found": "Not found",
  validation: "Request validation failed",
  conflict: "Conflict with the current state",
  "rate-limited": "Too many requests",
  "not-configured": "Endpoint not configured",
  unavailable: "Service unavailable",
  internal: "Internal error",
};

export function problem(
  type: ProblemType,
  detail?: string,
  init: { headers?: Record<string, string>; extra?: Record<string, unknown> } = {},
) {
  const status = STATUS[type];
  return NextResponse.json(
    { type: TYPE_BASE + type, title: TITLE[type], status, ...(detail ? { detail } : {}), ...init.extra },
    { status, headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store", ...init.headers } },
  );
}

export function tooManyRequests(retryAfter: number, detail = "Please wait before retrying.") {
  return problem("rate-limited", detail, { headers: { "Retry-After": String(retryAfter) } });
}

/** Maps thrown errors to problem responses so handlers never return 200 with an error body. */
export function problemFromError(err: unknown) {
  if (err instanceof RateLimitedError) return tooManyRequests(err.retryAfter, err.message);
  if (err instanceof DomainError) {
    const type: ProblemType =
      err.code === "not_found"
        ? "not-found"
        : err.code === "forbidden"
          ? "forbidden"
          : err.code === "idempotency_mismatch" || err.code === "invalid_transition"
            ? "conflict"
            : "validation";
    return problem(type, err.message);
  }
  console.error(JSON.stringify({ event: "api.unhandled_error", error: String((err as Error)?.message ?? err) }));
  return problem("internal");
}

export function clientIpFrom(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
