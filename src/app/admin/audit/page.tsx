import { requirePermission } from "@/lib/auth/session";
import { query } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Audit log" };

export default async function AuditLog({ searchParams }: { searchParams: Promise<{ action?: string; target?: string }> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const params: unknown[] = [];
  const where = ["true"];
  if (sp.action) {
    params.push(`${sp.action}%`);
    where.push(`a.action LIKE $${params.length}`);
  }
  if (sp.target) {
    params.push(sp.target);
    where.push(`a.target_id = $${params.length}`);
  }
  const rows = await query<{ id: string; action: string; target_type: string; target_id: string | null; reason: string | null; metadata: Record<string, unknown>; created_at: Date; actor: string | null }>(
    `SELECT a.*, u.display_name AS actor FROM admin_audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE ${where.join(" AND ")} ORDER BY a.id DESC LIMIT 200`,
    params,
  );
  return (
    <>
      <h1>Audit log</h1>
      <p className="small muted">Append-only record of sensitive staff actions. Entries cannot be edited or deleted.</p>
      <form className="row">
        <input name="action" defaultValue={sp.action} placeholder="Action prefix, e.g. credit." aria-label="Action" />
        <input name="target" defaultValue={sp.target} placeholder="Target ID" aria-label="Target ID" />
        <button className="btn btn-sm">Filter</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Reason</th><th>Details</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono small">{r.id}</td>
                <td className="small nowrap">{fmtDateTime(r.created_at)}</td>
                <td className="small">{r.actor ?? "system"}</td>
                <td className="small mono">{r.action}</td>
                <td className="small">{r.target_type} <span className="mono tiny">{r.target_id?.slice(0, 8)}</span></td>
                <td className="small">{r.reason}</td>
                <td className="tiny mono">{Object.keys(r.metadata ?? {}).length ? JSON.stringify(r.metadata) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
