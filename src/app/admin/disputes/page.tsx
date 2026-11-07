import Link from "next/link";
import { requirePermission } from "@/shared/api/session";
import { query } from "@/server/db";
import { DISPUTE_TYPES } from "@/shared/lib/vocab";
import { fmtDateTime, relative, shortId } from "@/shared/lib/format";
import { Badge, Empty } from "@/shared/ui/primitives";

export const metadata = { title: "Disputes" };

export default async function AdminDisputes({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requirePermission("disputes.manage");
  const { all } = await searchParams;
  const rows = await query<{ id: string; issue_type: string; status: string; outcome: string | null; created_at: Date; title: string; opener: string; assignee: string | null; exchange_id: string; route: string }>(
    `SELECT d.id, d.issue_type, d.status, d.outcome, d.created_at, b.title, o.display_name AS opener, a.display_name AS assignee, d.exchange_id,
       e.origin_country || ' → ' || e.destination_country AS route
     FROM disputes d JOIN exchanges e ON e.id = d.exchange_id JOIN listings l ON l.id = e.listing_id JOIN books b ON b.id = l.book_id
     JOIN users o ON o.id = d.opened_by LEFT JOIN users a ON a.id = d.assigned_to
     ${all ? "" : "WHERE d.status <> 'resolved'"} ORDER BY d.created_at LIMIT 200`,
  );
  return (
    <>
      <div className="row-between">
        <h1 className="mb-0">Disputes</h1>
        <Link href={all ? "/admin/disputes" : "/admin/disputes?all=1"} className="small">{all ? "Open only" : "Include resolved"}</Link>
      </div>
      {rows.length === 0 ? <Empty>No open disputes.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Case</th><th>Issue</th><th>Book</th><th>Route</th><th>Opened</th><th>Status</th><th>Assignee</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="mono small"><Link href={`/disputes/${d.id}`}>{shortId(d.id)}</Link></td>
                  <td className="small">{DISPUTE_TYPES[d.issue_type]}</td>
                  <td className="small"><Link href={`/admin/exchanges/${d.exchange_id}`}>{d.title}</Link><div className="tiny muted">by {d.opener}</div></td>
                  <td className="small nowrap">{d.route}</td>
                  <td className="small nowrap" title={fmtDateTime(d.created_at)}>{relative(d.created_at)}</td>
                  <td><Badge tone={d.status === "resolved" ? "ok" : d.status === "awaiting_info" ? "warn" : "danger"}>{d.status.replace("_", " ")}{d.outcome ? ` · ${d.outcome.replace(/_/g, " ")}` : ""}</Badge></td>
                  <td className="small">{d.assignee ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
