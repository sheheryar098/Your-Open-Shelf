import Link from "next/link";
import { requirePermission } from "@/shared/api/session";
import { overview } from "@/server/domain/analytics";
import { reconcile } from "@/server/domain/credits";
import { can } from "@/server/rbac";
import { jobHealth } from "@/server/jobs/runner";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { runJobsAction } from "@/features/admin/api/actions";

export default async function AdminOverview() {
  const u = await requirePermission("staff.access");
  const [o, mismatches, health] = await Promise.all([overview(), reconcile(), jobHealth()]);
  const tile = (v: number | string, k: string, href?: string, accent = false) =>
    href ? (
      <Link href={href} className={`stat ${accent ? "stat-accent" : ""}`}>
        <div className="v">{v}</div>
        <div className="k">{k}</div>
      </Link>
    ) : (
      <div className={`stat ${accent ? "stat-accent" : ""}`}>
        <div className="v">{v}</div>
        <div className="k">{k}</div>
      </div>
    );
  return (
    <>
      <h1>Overview</h1>
      {!health.ok && (
        <div className="alert alert-error">
          Background jobs need attention: {health.alerts[0]} <Link href="/admin/jobs">Details</Link>
        </div>
      )}
      {mismatches.length > 0 && (
        <div className="alert alert-error">
          Credit ledger reconciliation found {mismatches.length} mismatched account(s).{" "}
          <Link href="/admin/credits">Investigate</Link>
        </div>
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
      <section className={`card card-flat`} style={health.ok ? undefined : { borderColor: "var(--danger)" }}>
        <div className="card-header">
          <h3>Scheduled jobs</h3>
          <Link href="/admin/jobs" className="small">
            Jobs &amp; queues →
          </Link>
        </div>
        {health.ok ? (
          <p className="small muted mb-0">All jobs healthy. {health.emailQueued} email(s) queued.</p>
        ) : (
          <ul className="small mb-0">
            {health.alerts.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
        {can(u.role, "exchanges.intervene") && (
          <ActionForm action={runJobsAction} className="row">
            <SubmitButton className="btn btn-sm">Run all jobs now</SubmitButton>
          </ActionForm>
        )}
      </section>
    </>
  );
}
