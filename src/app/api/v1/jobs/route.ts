import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runJobs } from "@/server/jobs/runner";
import { rateLimit } from "@/server/rate-limit";
import { clientIpFrom, problem, problemFromError, tooManyRequests } from "@/shared/api/http";

function secretMatches(given: string, secret: string) {
  return given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

/**
 * POST /api/v1/jobs — run every scheduled job once. Called by an external scheduler.
 * Idempotent: each job holds an advisory lock and each item re-checks its state.
 */
export async function POST(req: Request) {
  const secret = process.env.JOBS_SECRET;
  if (!secret || secret === "change-me") return problem("not-configured", "Set JOBS_SECRET to enable this endpoint.");
  const given = req.headers.get("x-jobs-secret") ?? "";
  if (!secretMatches(given, secret)) {
    const r = rateLimit(`jobs-auth:${clientIpFrom(req)}`, 10, 60_000);
    if (!r.ok) return tooManyRequests(r.retryAfter);
    return problem("unauthenticated", "Missing or invalid x-jobs-secret header.", { headers: { "WWW-Authenticate": 'Header realm="jobs"' } });
  }
  try {
    const result = await runJobs();
    return NextResponse.json({ data: { jobs: result } }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return problemFromError(err);
  }
}
