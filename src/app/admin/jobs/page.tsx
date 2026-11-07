import { requirePermission } from "@/shared/api/session";
import { query } from "@/server/db";
import { can } from "@/server/rbac";
import { JOBS, MAX_ITEM_ATTEMPTS, jobHealth } from "@/server/jobs/runner";
import { cacheStats } from "@/server/cache";
import { fmtDateTime, relative } from "@/shared/lib/format";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { Badge, Empty } from "@/shared/ui/primitives";
import { parkedItemAction, requeueEmailAction, runJobsAction } from "@/features/admin/api/actions";

export const metadata = { title: "Jobs & queues" };

export default async function AdminJobs() {
  const u = await requirePermission("exchanges.view");
  const canAct = can(u.role, "exchanges.intervene");
  const [health, failures, deadEmails, caches] = await Promise.all([
    jobHealth(),
    query<{ id: string; job: string; entity_id: string; error: string; attempts: number; last_failed_at: Date }>(
      "SELECT id, job, entity_id, error, attempts, last_failed_at FROM job_failures WHERE resolved_at IS NULL ORDER BY last_failed_at DESC LIMIT 100",
    ),
    query<{ id: string; to_email: string; subject: string; attempts: number; last_error: string | null; created_at: Date }>(
      "SELECT id, to_email, subject, attempts, last_error, created_at FROM email_outbox WHERE status = 'dead' ORDER BY created_at DESC LIMIT 50",
    ),
    cacheStats(),
  ]);
  const runs = new Map(health.jobs.map((j) => [j.name, j]));
  return (
    <>
      <div className="row-between">
        <h1 className="mb-0">Jobs &amp; queues</h1>
        {canAct && <ActionForm action={runJobsAction} className="inline-form"><SubmitButton className="btn btn-sm">Run all jobs now</SubmitButton></ActionForm>}
      </div>
      {health.ok ? <div className="alert alert-ok">All jobs healthy.</div> : (
        <div className="alert alert-error"><ul className="mb-0">{health.alerts.map((a) => <li key={a}>{a}</li>)}</ul></div>
      )}
      <div className="stats">
        <div className="stat"><div className="v">{health.emailQueued}</div><div className="k">Emails queued</div></div>
        <div className="stat"><div className="v">{health.oldestQueuedEmailSeconds ? `${Math.round(health.oldestQueuedEmailSeconds / 60)}m` : "—"}</div><div className="k">Oldest queued email</div></div>
        <div className="stat"><div className="v">{health.deadEmails}</div><div className="k">Dead emails</div></div>
        <div className="stat"><div className="v">{health.parkedItems}</div><div className="k">Parked job items</div></div>
        <div className="stat"><div className="v">{health.overdueExchanges}</div><div className="k">Overdue deadlines</div></div>
      </div>

      <section>
        <h2>Jobs</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Job</th><th>Last status</th><th>Last success</th><th className="num">Duration</th><th className="num">Consecutive failures</th></tr></thead>
            <tbody>
              {Object.keys(JOBS).map((name) => {
                const r = runs.get(name);
                return (
                  <tr key={name}>
                    <td className="mono small">{name}</td>
                    <td>{r?.last_status ? <Badge tone={r.last_status === "ok" ? "ok" : r.last_status === "partial" ? "warn" : "danger"}>{r.last_status}</Badge> : <span className="muted small">never run</span>}</td>
                    <td className="small">{r?.last_success_at ? relative(r.last_success_at) : "—"}</td>
                    <td className="num small">{r?.last_duration_ms != null ? `${r.last_duration_ms} ms` : "—"}</td>
                    <td className="num">{r?.consecutive_failures ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Failing and parked items</h2>
        <p className="small muted">Items are retried on each run and parked after {MAX_ITEM_ATTEMPTS} failed attempts so they can&apos;t block the queue.</p>
        {failures.length === 0 ? <Empty>No failing items.</Empty> : (
          <div className="stack">
            {failures.map((f) => (
              <div key={f.id} className="card card-flat">
                <div className="row-between">
                  <span><span className="mono small">{f.job}</span> · <span className="mono tiny">{f.entity_id}</span></span>
                  <Badge tone={f.attempts >= MAX_ITEM_ATTEMPTS ? "danger" : "warn"}>{f.attempts >= MAX_ITEM_ATTEMPTS ? "parked" : "retrying"} · {f.attempts} attempt(s)</Badge>
                </div>
                <p className="small mono" style={{ margin: "6px 0" }}>{f.error}</p>
                <p className="tiny muted">Last failed {fmtDateTime(f.last_failed_at)}</p>
                {canAct && (
                  <div className="row">
                    <ActionForm action={parkedItemAction.bind(null, f.id, "retry")} className="inline-form"><SubmitButton className="btn btn-sm">Retry</SubmitButton></ActionForm>
                    <ActionForm action={parkedItemAction.bind(null, f.id, "dismiss")} className="row">
                      <input name="note" required minLength={5} placeholder="How it was handled" aria-label="Resolution note" />
                      <SubmitButton className="btn btn-sm">Mark handled</SubmitButton>
                    </ActionForm>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>Dead emails</h2>
        {deadEmails.length === 0 ? <Empty>None.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>To</th><th>Subject</th><th>Error</th><th className="num">Attempts</th><th /></tr></thead>
              <tbody>
                {deadEmails.map((m) => (
                  <tr key={m.id}>
                    <td className="small">{m.to_email}</td>
                    <td className="small">{m.subject}</td>
                    <td className="small mono">{m.last_error}</td>
                    <td className="num">{m.attempts}</td>
                    <td>{canAct && <ActionForm action={requeueEmailAction.bind(null, m.id)} className="inline-form"><SubmitButton className="btn btn-sm">Re-queue</SubmitButton></ActionForm>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section>
        <h2>Caches</h2>
        <p className="small muted">Only slow or rate-limited upstream calls are cached. A falling hit rate with growing entries means the key space is too large.</p>
        {caches.length === 0 ? <Empty>No cache activity yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Cache</th><th className="num">Hit rate</th><th className="num">Hits</th><th className="num">Misses</th><th className="num">Upstream errors</th><th className="num">Entries</th></tr></thead>
              <tbody>
                {caches.map((c) => {
                  const total = Number(c.hits) + Number(c.misses);
                  return (
                    <tr key={c.name}>
                      <td className="mono small">{c.name}</td>
                      <td className="num">{total ? `${Math.round((Number(c.hits) / total) * 100)}%` : "—"}</td>
                      <td className="num">{c.hits}</td><td className="num">{c.misses}</td><td className="num">{c.errors}</td><td className="num">{c.entries}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
