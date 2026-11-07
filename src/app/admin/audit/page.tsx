import { requirePermission } from "@/shared/api/session";
import { auditLog } from "@/server/queries/admin";
import { fmtDateTime } from "@/shared/lib/format";

export const metadata = { title: "Audit log" };

export default async function AuditLog({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; target?: string }>;
}) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const rows = await auditLog({ actionPrefix: sp.action, targetId: sp.target });
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
          <thead>
            <tr>
              <th>#</th>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Reason</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono small">{r.id}</td>
                <td className="small nowrap">{fmtDateTime(r.created_at)}</td>
                <td className="small">{r.actor ?? "system"}</td>
                <td className="small mono">{r.action}</td>
                <td className="small">
                  {r.target_type} <span className="mono tiny">{r.target_id?.slice(0, 8)}</span>
                </td>
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
