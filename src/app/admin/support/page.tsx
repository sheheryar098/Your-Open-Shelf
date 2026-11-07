import Link from "next/link";
import { requirePermission } from "@/shared/api/session";
import { query } from "@/server/db";
import { TICKET_CATEGORIES } from "@/shared/lib/vocab";
import { relative, shortId } from "@/shared/lib/format";
import { Badge, Empty } from "@/shared/ui/primitives";

export const metadata = { title: "Support queue" };

export default async function AdminSupport({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requirePermission("support.manage");
  const { status = "active" } = await searchParams;
  const rows = await query<{ id: string; subject: string; category: string; status: string; priority: string; updated_at: Date; created_at: Date; who: string | null; assignee: string | null }>(
    `SELECT t.id, t.subject, t.category, t.status, t.priority, t.updated_at, t.created_at, coalesce(u.display_name, t.contact_email) AS who, a.display_name AS assignee
     FROM support_tickets t LEFT JOIN users u ON u.id = t.user_id LEFT JOIN users a ON a.id = t.assigned_to
     WHERE ${status === "active" ? "t.status IN ('open','in_progress','awaiting_member')" : status === "all" ? "true" : "t.status = $1"}
     ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at LIMIT 200`,
    status === "active" || status === "all" ? [] : [status],
  );
  return (
    <>
      <div className="row-between">
        <h1 className="mb-0">Support tickets</h1>
        <form className="row">
          <select name="status" defaultValue={status} aria-label="Status">
            <option value="active">Active</option><option value="open">Open</option><option value="in_progress">In progress</option>
            <option value="awaiting_member">Awaiting member</option><option value="resolved">Resolved</option><option value="closed">Closed</option><option value="all">All</option>
          </select>
          <button className="btn btn-sm">Filter</button>
        </form>
      </div>
      {rows.length === 0 ? <Empty>No tickets.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ticket</th><th>From</th><th>Category</th><th>Priority</th><th>Status</th><th>Age</th><th>Assignee</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td><Link href={`/support/${t.id}`}>{t.subject}</Link><div className="tiny muted mono">#{shortId(t.id)}</div></td>
                  <td className="small">{t.who}</td>
                  <td className="small">{TICKET_CATEGORIES[t.category]}</td>
                  <td><Badge tone={t.priority === "urgent" || t.priority === "high" ? "danger" : undefined}>{t.priority}</Badge></td>
                  <td className="small">{t.status.replace("_", " ")}</td>
                  <td className="small nowrap">{relative(t.created_at)}</td>
                  <td className="small">{t.assignee ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
