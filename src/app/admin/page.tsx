import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { overview } from "@/domain/analytics";
import { reconcile } from "@/domain/credits";
import { queryOne } from "@/lib/db";
import { can } from "@/lib/rbac";
import { fmtDateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { runJobsAction } from "@/app/actions/admin";

export default async function AdminOverview() {
  const u = await requirePermission("staff.access");
  const [o, mismatches, lastJobs] = await Promise.all([
    overview(),
    reconcile(),
    queryOne<{ last_run_at: Date }>("SELECT last_run_at FROM job_runs WHERE name = 'all'"),
  ]);
  const tile = (v: number | string, k: string, href?: string, accent = false) =>
    href ? <Link href={href} className={`stat ${accent ? "stat-accent" : ""}`}><div className="v">{v}</div><div className="k">{k}</div></Link>
      : <div className={`stat ${accent ? "stat-accent" : ""}`}><div className="v">{v}</div><div className="k">{k}</div></div>;
  return (
    <>
      <h1>Overview</h1>
      {mismatches.length > 0 && (
        <div className="alert alert-error">Credit ledger reconciliation found {mismatches.length} mismatched account(s). <Link href="/admin/credits">Investigate</Link></div>
      )}
      <section>
        <h2>Work queues</h2>
        <div className="stats">
          {tile(o.open_disputes, "Open disputes", "/admin/disputes", o.open_disputes > 0)}
          {tile(o.open_reports, "Open reports", "/admin/reports", o.open_reports > 0)}
          {tile(o.open_tickets, "Open support tickets", "/admin/support", o.open_tickets > 0)}
          {tile(o.live_exchanges, "Live exchanges", "/admin/exchanges")}
        </div>
      </section>
      <section>
        <h2>Marketplace</h2>
        <div className="stats">
          {tile(o.members, "Registered members", "/admin/members")}
          {tile(o.active_members, "Active (30 days)")}
          {tile(o.new_members_7d, "New this week")}
          {tile(o.active_listings, "Active listings", "/admin/listings")}
          {tile(o.requests_30d, "Requests (30 days)")}
          {tile(o.completed_30d, "Completed exchanges (30 days)", "/admin/analytics", true)}
          {tile(o.avg_dispatch_hours ? `${(o.avg_dispatch_hours / 24).toFixed(1)}d` : "—", "Avg. time to dispatch")}
        </div>
      </section>
      <section>
        <h2>Credits</h2>
        <div className="stats">
          {tile(o.credits_issued_30d, "Earned (30 days)", "/admin/credits")}
          {tile(o.credits_redeemed_30d, "Spent (30 days)")}
          {tile(o.credits_outstanding, "Outstanding (available + reserved)")}
          {tile(mismatches.length === 0 ? "✓" : mismatches.length, "Ledger reconciliation")}
        </div>
      </section>
      {can(u.role, "exchanges.intervene") && (
        <section className="card card-flat">
          <h3>Scheduled jobs</h3>
          <p className="small muted">Deadlines, auto-confirmation, completion, reminders, stale listings, address redaction and email delivery. Last run: {lastJobs ? fmtDateTime(lastJobs.last_run_at) : "never"}.</p>
          <ActionForm action={runJobsAction}>
            <SubmitButton className="btn btn-sm">Run now</SubmitButton>
          </ActionForm>
        </section>
      )}
    </>
  );
}
