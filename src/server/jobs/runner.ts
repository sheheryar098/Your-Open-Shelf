import { randomUUID } from "node:crypto";
import { pool, query, queryOne } from "@/server/db";
import { now } from "@/server/clock";
import { exchangeJobs, redactClosedAddresses } from "@/server/domain/exchanges/jobs";
import { staleListingsJob } from "@/server/domain/listings";
import { emailJobs } from "./email";
import { purgeExpired } from "@/server/cache";
import { auditStaffAction } from "@/server/domain/audit";
import type { DueItemJob } from "./types";

/**
 * Scheduled work.
 *
 *  - small, single-purpose jobs, each idempotent per item;
 *  - one instance at a time per job (Postgres advisory lock keyed on the job name);
 *  - one failing item never blocks the rest: it's retried on later runs, then parked in
 *    `job_failures` (dead letter) after MAX_ITEM_ATTEMPTS;
 *  - a time budget per run, statement timeouts per item, and a structured log line per run;
 *  - run records in `job_runs` so health checks can alert on age, not just failures.
 */

export const MAX_ITEM_ATTEMPTS = 5;
const BATCH = 200;

type JobDef =
  | { kind: "items"; job: DueItemJob; budgetMs: number }
  | { kind: "single"; run: (t: Date) => Promise<number>; budgetMs: number };

/** Order matters: security email first, then state changes, then the mail they produced. */
export const JOBS: Record<string, JobDef> = {
  "email.deliver-priority": { kind: "items", job: emailJobs["email.deliver-priority"], budgetMs: 20_000 },
  "exchanges.expire-requests": { kind: "items", job: exchangeJobs["exchanges.expire-requests"], budgetMs: 30_000 },
  "exchanges.cancel-missed-dispatch": {
    kind: "items",
    job: exchangeJobs["exchanges.cancel-missed-dispatch"],
    budgetMs: 30_000,
  },
  "exchanges.auto-confirm-delivery": {
    kind: "items",
    job: exchangeJobs["exchanges.auto-confirm-delivery"],
    budgetMs: 30_000,
  },
  "exchanges.complete-after-window": {
    kind: "items",
    job: exchangeJobs["exchanges.complete-after-window"],
    budgetMs: 30_000,
  },
  "exchanges.respond-reminders": { kind: "items", job: exchangeJobs["exchanges.respond-reminders"], budgetMs: 15_000 },
  "exchanges.dispatch-reminders": {
    kind: "items",
    job: exchangeJobs["exchanges.dispatch-reminders"],
    budgetMs: 15_000,
  },
  "listings.pause-stale": { kind: "items", job: staleListingsJob, budgetMs: 15_000 },
  "privacy.redact-addresses": { kind: "single", run: redactClosedAddresses, budgetMs: 15_000 },
  "cache.purge-expired": { kind: "single", run: purgeExpired, budgetMs: 10_000 },
  "email.deliver": { kind: "items", job: emailJobs["email.deliver"], budgetMs: 30_000 },
};

export interface JobResult {
  status: "ok" | "partial" | "failed" | "skipped";
  processed: number;
  failed: number;
  parked: number;
  durationMs: number;
}

async function recordFailure(job: string, entityId: string, err: unknown): Promise<number> {
  const r = await queryOne<{ attempts: number }>(
    `INSERT INTO job_failures (job, entity_id, error) VALUES ($1, $2, $3)
         ON CONFLICT (job, entity_id) WHERE resolved_at IS NULL
         DO UPDATE SET attempts = job_failures.attempts + 1, error = EXCLUDED.error, last_failed_at = now()
     RETURNING attempts`,
    [job, entityId, String((err as Error)?.message ?? err).slice(0, 1000)],
  );
  return r?.attempts ?? 1;
}

async function clearFailure(job: string, entityId: string) {
  await query(
    `UPDATE job_failures SET resolved_at = now(), resolution = 'succeeded on retry'
      WHERE job = $1 AND entity_id = $2 AND resolved_at IS NULL`,
    [job, entityId],
  );
}

async function openFailures(job: string) {
  const rows = await query<{ entity_id: string; attempts: number }>(
    "SELECT entity_id, attempts FROM job_failures WHERE job = $1 AND resolved_at IS NULL",
    [job],
  );
  return {
    parked: new Set(rows.filter((r) => r.attempts >= MAX_ITEM_ATTEMPTS).map((r) => r.entity_id)),
    retrying: new Set(rows.filter((r) => r.attempts < MAX_ITEM_ATTEMPTS).map((r) => r.entity_id)),
  };
}

/** Runs one job once. Returns `skipped` if another instance holds its lock. */
export async function runJob(name: string): Promise<JobResult> {
  const def = JOBS[name];
  if (!def) throw new Error(`Unknown job ${name}`);
  const runId = randomUUID();
  const started = Date.now();
  const lockClient = await pool().connect();
  let locked = false;
  try {
    locked = (
      await lockClient.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [`yos-job:${name}`])
    ).rows[0].ok;
    if (!locked) return { status: "skipped", processed: 0, failed: 0, parked: 0, durationMs: 0 };
    const t = now();
    await query(
      `INSERT INTO job_runs (name, last_started_at) VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET last_started_at = EXCLUDED.last_started_at`,
      [name, new Date()],
    );

    let processed = 0;
    let failed = 0;
    let fatal: unknown = null;
    try {
      if (def.kind === "single") {
        processed = await def.run(t);
      } else {
        const { parked, retrying } = await openFailures(name);
        const ids = (await def.job.find(t, BATCH + parked.size)).filter((id) => !parked.has(id)).slice(0, BATCH);
        for (const id of ids) {
          if (Date.now() - started > def.budgetMs) break; // the rest is picked up next run
          try {
            if (await def.job.handle(id, t)) processed++;
            if (retrying.has(id)) await clearFailure(name, id);
          } catch (err) {
            failed++;
            const attempts = await recordFailure(name, id, err);
            console.error(
              JSON.stringify({
                event: "job.item_failed",
                job: name,
                run_id: runId,
                entity_id: id,
                attempt: attempts,
                error: String((err as Error)?.message ?? err),
              }),
            );
          }
        }
      }
    } catch (err) {
      fatal = err; // e.g. the `find` query itself failed
    }

    const parkedCount = Number(
      (
        await queryOne<{ n: string }>(
          "SELECT count(*) AS n FROM job_failures WHERE job = $1 AND resolved_at IS NULL AND attempts >= $2",
          [name, MAX_ITEM_ATTEMPTS],
        )
      )?.n ?? 0,
    );
    const status: JobResult["status"] = fatal ? "failed" : failed > 0 ? "partial" : "ok";
    const durationMs = Date.now() - started;
    await query(
      `UPDATE job_runs SET last_finished_at = $2, last_status = $3, last_duration_ms = $4, last_result = $5, last_error = $6,
         last_success_at = CASE WHEN $3 = 'failed' THEN last_success_at ELSE $2 END,
         consecutive_failures = CASE WHEN $3 = 'failed' THEN consecutive_failures + 1 ELSE 0 END
        WHERE name = $1`,
      [
        name,
        new Date(),
        status,
        durationMs,
        JSON.stringify({ processed, failed, parked: parkedCount }),
        fatal ? String((fatal as Error).message ?? fatal) : null,
      ],
    );
    const log = {
      event: "job.run",
      job: name,
      run_id: runId,
      status,
      processed,
      failed,
      parked: parkedCount,
      duration_ms: durationMs,
    };
    if (status === "ok" && processed === 0) {
      if (process.env.JOBS_VERBOSE === "true") console.info(JSON.stringify(log));
    } else if (!process.env.VITEST) {
      console.info(JSON.stringify(log));
    }
    return { status, processed, failed, parked: parkedCount, durationMs };
  } finally {
    if (locked) await lockClient.query("SELECT pg_advisory_unlock(hashtext($1))", [`yos-job:${name}`]).catch(() => {});
    lockClient.release();
  }
}

/** Runs every job once, in order. Safe to call from several instances at the same time. */
export async function runJobs(): Promise<Record<string, JobResult>> {
  const out: Record<string, JobResult> = {};
  for (const name of Object.keys(JOBS)) {
    try {
      out[name] = await runJob(name);
    } catch (err) {
      console.error(JSON.stringify({ event: "job.crashed", job: name, error: String((err as Error)?.message ?? err) }));
      out[name] = { status: "failed", processed: 0, failed: 0, parked: 0, durationMs: 0 };
    }
  }
  return out;
}

let inflight: Promise<unknown> | null = null;
let lastTick = 0;

/**
 * Opportunistic trigger so deadlines are still enforced if the external scheduler stops.
 * Production should call POST /api/v1/jobs (or `npm run jobs`) every few minutes.
 */
export async function runJobsIfDue(minIntervalMs = 60_000) {
  if (inflight || Date.now() - lastTick < minIntervalMs) return;
  lastTick = Date.now();
  inflight = runJobs().finally(() => {
    inflight = null;
  });
  await inflight;
}

// ---------------------------------------------------------------------------
// Health: alert on age, not just depth
// ---------------------------------------------------------------------------

export interface JobHealth {
  ok: boolean;
  alerts: string[];
  emailQueued: number;
  oldestQueuedEmailSeconds: number;
  deadEmails: number;
  parkedItems: number;
  overdueExchanges: number;
  jobs: {
    name: string;
    last_status: string | null;
    last_success_at: Date | null;
    last_duration_ms: number | null;
    consecutive_failures: number;
  }[];
}

export async function jobHealth(): Promise<JobHealth> {
  const t = now();
  const [email, parked, overdue, jobs] = await Promise.all([
    queryOne<{ queued: string; dead: string; oldest: string | null }>(
      `SELECT count(*) FILTER (WHERE status = 'queued') AS queued, count(*) FILTER (WHERE status = 'dead') AS dead,
         extract(epoch FROM $1::timestamptz - min(created_at) FILTER (WHERE status = 'queued')) AS oldest FROM email_outbox`,
      [t],
    ),
    queryOne<{ n: string }>("SELECT count(*) AS n FROM job_failures WHERE resolved_at IS NULL AND attempts >= $1", [
      MAX_ITEM_ATTEMPTS,
    ]),
    // Deadlines that passed more than 30 minutes ago but weren't processed: the scheduler is behind.
    queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM exchanges WHERE
         (status = 'requested' AND respond_by < $1::timestamptz - interval '30 minutes')
         OR (status = 'accepted' AND dispatch_by < $1::timestamptz - interval '30 minutes')
         OR (status = 'delivered' AND completion_due_at < $1::timestamptz - interval '30 minutes')`,
      [t],
    ),
    query<JobHealth["jobs"][number]>(
      "SELECT name, last_status, last_success_at, last_duration_ms, consecutive_failures FROM job_runs ORDER BY name",
    ),
  ]);
  const oldest = Math.round(Number(email?.oldest ?? 0));
  const alerts: string[] = [];
  if (oldest > 15 * 60) alerts.push(`Oldest queued email is ${Math.round(oldest / 60)} minutes old.`);
  if (Number(email?.dead) > 0) alerts.push(`${email?.dead} email(s) failed permanently.`);
  if (Number(parked?.n) > 0) alerts.push(`${parked?.n} job item(s) parked after repeated failures.`);
  if (Number(overdue?.n) > 0) alerts.push(`${overdue?.n} exchange deadline(s) are overdue. Is the scheduler running?`);
  for (const j of jobs)
    if (j.consecutive_failures >= 3) alerts.push(`Job ${j.name} has failed ${j.consecutive_failures} times in a row.`);
  return {
    ok: alerts.length === 0,
    alerts,
    emailQueued: Number(email?.queued ?? 0),
    oldestQueuedEmailSeconds: oldest,
    deadEmails: Number(email?.dead ?? 0),
    parkedItems: Number(parked?.n ?? 0),
    overdueExchanges: Number(overdue?.n ?? 0),
    jobs,
  };
}

/** Puts a parked item back in the queue, or closes it as handled by hand. */
export async function resolveParkedItem(staffId: string, id: string, action: "retry" | "dismiss", note: string) {
  if (action === "retry") {
    await query("UPDATE job_failures SET attempts = 0 WHERE id = $1 AND resolved_at IS NULL", [id]);
  } else {
    await query("UPDATE job_failures SET resolved_at = now(), resolution = $2 WHERE id = $1 AND resolved_at IS NULL", [
      id,
      note,
    ]);
  }
  await auditStaffAction({
    actorId: staffId,
    action: `job.${action}`,
    targetType: "job_failure",
    targetId: id,
    reason: note,
  });
}

export async function requeueDeadEmail(staffId: string, id: string) {
  await query(
    `UPDATE email_outbox SET status = 'queued', attempts = 0, next_attempt_at = now(), last_error = NULL
      WHERE id = $1 AND status = 'dead'`,
    [id],
  );
  await auditStaffAction({ actorId: staffId, action: "email.requeue", targetType: "email", targetId: id });
}
