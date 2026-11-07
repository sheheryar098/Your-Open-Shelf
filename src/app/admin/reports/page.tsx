import Link from "next/link";
import { requirePermission } from "@/shared/api/session";
import { openReports } from "@/server/queries/admin";
import { REPORT_REASONS } from "@/shared/lib/vocab";
import { fmtDateTime } from "@/shared/lib/format";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { Badge, Empty } from "@/shared/ui/primitives";
import { handleReportAction } from "@/features/admin/api/actions";

export const metadata = { title: "Reports" };

export default async function AdminReports() {
  await requirePermission("reports.manage");
  const rows = await openReports();
  return (
    <>
      <h1>Reports</h1>
      {rows.length === 0 ? (
        <Empty>No open reports.</Empty>
      ) : (
        <div className="stack">
          {rows.map((r) => (
            <div key={r.id} className="card card-flat">
              <div className="row-between">
                <div className="row">
                  <Badge tone="danger">{r.target_type}</Badge>
                  <strong>{REPORT_REASONS[r.reason]}</strong>
                </div>
                <span className="small muted">
                  {fmtDateTime(r.created_at)} · by <Link href={`/admin/members/${r.reporter_id}`}>{r.reporter}</Link>
                </span>
              </div>
              <p className="small" style={{ margin: "8px 0" }}>
                {r.target_type === "listing" ? (
                  <Link href={`/books/${r.target_id}`}>{r.preview}</Link>
                ) : r.target_type === "member" ? (
                  <Link href={`/admin/members/${r.target_id}`}>{r.preview}</Link>
                ) : (
                  <q>{r.preview}</q>
                )}
                {r.author_id && r.target_type !== "member" && (
                  <>
                    {" "}
                    · author <Link href={`/admin/members/${r.author_id}`}>view member</Link>
                  </>
                )}
              </p>
              {r.details && <p className="small muted">“{r.details}”</p>}
              <ActionForm action={handleReportAction.bind(null, r.id)} className="row">
                <input type="hidden" name="targetType" value={r.target_type} />
                <input type="hidden" name="targetId" value={r.target_id} />
                <select name="status" defaultValue="actioned" aria-label="Outcome">
                  <option value="actioned">Action taken</option>
                  <option value="dismissed">Dismiss</option>
                </select>
                {r.target_type !== "member" && (
                  <label className="check small">
                    <input type="checkbox" name="hideTarget" />{" "}
                    {r.target_type === "listing" ? "Mark listing under review" : "Hide this content"}
                  </label>
                )}
                <input
                  name="note"
                  type="text"
                  required
                  minLength={5}
                  placeholder="Resolution note (internal)"
                  aria-label="Resolution note"
                  style={{ flex: 1, minWidth: 180 }}
                />
                <SubmitButton className="btn btn-sm">Close report</SubmitButton>
              </ActionForm>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
