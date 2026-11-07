import Link from "next/link";
import { requirePermission } from "@/shared/api/session";
import { query } from "@/server/db";
import { REPORT_REASONS } from "@/shared/lib/vocab";
import { fmtDateTime } from "@/shared/lib/format";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { Badge, Empty } from "@/shared/ui/primitives";
import { handleReportAction } from "@/features/admin/api/actions";

export const metadata = { title: "Reports" };

export default async function AdminReports() {
  await requirePermission("reports.manage");
  const rows = await query<{ id: string; target_type: string; target_id: string; reason: string; details: string | null; created_at: Date; reporter: string; reporter_id: string; preview: string | null; owner_id: string | null }>(
    `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.created_at, u.display_name AS reporter, r.reporter_id,
       CASE r.target_type
         WHEN 'listing' THEN (SELECT b.title FROM listings l JOIN books b ON b.id = l.book_id WHERE l.id = r.target_id)
         WHEN 'member' THEN (SELECT display_name FROM users WHERE id = r.target_id)
         WHEN 'review' THEN (SELECT coalesce(comment, rating || ' stars') FROM reviews WHERE id = r.target_id)
         WHEN 'message' THEN (SELECT body FROM messages WHERE id = r.target_id)
       END AS preview,
       CASE r.target_type
         WHEN 'listing' THEN (SELECT owner_id FROM listings WHERE id = r.target_id)
         WHEN 'member' THEN r.target_id
         WHEN 'review' THEN (SELECT reviewer_id FROM reviews WHERE id = r.target_id)
         WHEN 'message' THEN (SELECT sender_id FROM messages WHERE id = r.target_id)
       END AS owner_id
     FROM reports r JOIN users u ON u.id = r.reporter_id WHERE r.status = 'open' ORDER BY r.created_at LIMIT 100`,
  );
  return (
    <>
      <h1>Reports</h1>
      {rows.length === 0 ? <Empty>No open reports.</Empty> : (
        <div className="stack">
          {rows.map((r) => (
            <div key={r.id} className="card card-flat">
              <div className="row-between">
                <div className="row"><Badge tone="danger">{r.target_type}</Badge><strong>{REPORT_REASONS[r.reason]}</strong></div>
                <span className="small muted">{fmtDateTime(r.created_at)} · by <Link href={`/admin/members/${r.reporter_id}`}>{r.reporter}</Link></span>
              </div>
              <p className="small" style={{ margin: "8px 0" }}>
                {r.target_type === "listing" ? <Link href={`/books/${r.target_id}`}>{r.preview}</Link> : r.target_type === "member" ? <Link href={`/admin/members/${r.target_id}`}>{r.preview}</Link> : <q>{r.preview}</q>}
                {r.owner_id && r.target_type !== "member" && <> · author <Link href={`/admin/members/${r.owner_id}`}>view member</Link></>}
              </p>
              {r.details && <p className="small muted">“{r.details}”</p>}
              <ActionForm action={handleReportAction.bind(null, r.id)} className="row">
                <input type="hidden" name="targetType" value={r.target_type} />
                <input type="hidden" name="targetId" value={r.target_id} />
                <select name="status" defaultValue="actioned" aria-label="Outcome"><option value="actioned">Action taken</option><option value="dismissed">Dismiss</option></select>
                {r.target_type !== "member" && <label className="check small"><input type="checkbox" name="hideTarget" /> {r.target_type === "listing" ? "Mark listing under review" : "Hide this content"}</label>}
                <input name="note" type="text" required minLength={5} placeholder="Resolution note (internal)" aria-label="Resolution note" style={{ flex: 1, minWidth: 180 }} />
                <SubmitButton className="btn btn-sm">Close report</SubmitButton>
              </ActionForm>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
