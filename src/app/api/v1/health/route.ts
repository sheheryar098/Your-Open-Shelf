import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { databaseIsUp } from "@/server/queries/site";
import { jobHealth } from "@/server/jobs/runner";

/**
 * GET /api/v1/health, for uptime monitors. Returns 200 when healthy and 503 when the database is
 * down or background work is falling behind. Details such as
 * alert text are only returned with the jobs secret.
 */
export async function GET(req: Request) {
  const database = (await databaseIsUp()) ? "ok" : "down";
  const jobs = database === "ok" ? await jobHealth() : null;
  const healthy = database === "ok" && !!jobs?.ok;
  const secret = process.env.JOBS_SECRET ?? "";
  const given = req.headers.get("x-jobs-secret") ?? "";
  const detailed =
    secret.length > 0 &&
    secret !== "change-me" &&
    given.length === secret.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  const body = {
    data: {
      status: healthy ? "ok" : "degraded",
      checks: { database, jobs: jobs ? (jobs.ok ? "ok" : "degraded") : "unknown" },
      ...(detailed && jobs
        ? {
            alerts: jobs.alerts,
            queues: {
              email_queued: jobs.emailQueued,
              oldest_queued_email_seconds: jobs.oldestQueuedEmailSeconds,
              dead_emails: jobs.deadEmails,
              parked_items: jobs.parkedItems,
            },
          }
        : {}),
    },
  };
  return NextResponse.json(body, { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
