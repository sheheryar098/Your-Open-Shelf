import { pool, queryOne } from "@/lib/db";
import { now } from "@/lib/clock";
import { processDueExchanges } from "./exchanges";
import { pauseStaleListings } from "./listings";
import { deliverQueuedEmail } from "./notifications";

/** Runs all scheduled work once. Safe to call concurrently: rows are locked with SKIP LOCKED. */
export async function runJobs() {
  const exchanges = await processDueExchanges();
  const staleListings = await pauseStaleListings(pool());
  const emails = await deliverQueuedEmail(pool());
  await pool().query(
    "INSERT INTO job_runs (name, last_run_at) VALUES ('all', $1) ON CONFLICT (name) DO UPDATE SET last_run_at = EXCLUDED.last_run_at",
    [now()],
  );
  return { ...exchanges, staleListings, emails };
}

let inflight: Promise<unknown> | null = null;

/**
 * Opportunistic trigger so deadlines are enforced even without an external scheduler.
 * Production deployments should also call POST /api/jobs (or `npm run jobs`) every few minutes.
 */
export async function runJobsIfDue(minIntervalMs = 60_000) {
  if (inflight) return;
  const last = await queryOne<{ last_run_at: Date }>("SELECT last_run_at FROM job_runs WHERE name = 'all'");
  if (last && now().getTime() - new Date(last.last_run_at).getTime() < minIntervalMs) return;
  inflight = runJobs()
    .catch((err) => console.error("[jobs] failed", err))
    .finally(() => {
      inflight = null;
    });
  await inflight;
}
