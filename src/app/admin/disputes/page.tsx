import Link from "next/link";
import { requirePermission } from "@/shared/api/session";
import { disputeQueue } from "@/server/queries/admin";
import { DISPUTE_TYPES } from "@/shared/lib/vocab";
import { fmtDateTime, relative, shortId } from "@/shared/lib/format";
import { Badge, Empty } from "@/shared/ui/primitives";

export const metadata = { title: "Disputes" };

export default async function AdminDisputes({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requirePermission("disputes.manage");
  const { all } = await searchParams;
  const rows = await disputeQueue(!!all);
  return (
    <>
      <div className="row-between">
        <h1 className="mb-0">Disputes</h1>
        <Link href={all ? "/admin/disputes" : "/admin/disputes?all=1"} className="small">
          {all ? "Open only" : "Include resolved"}
        </Link>
      </div>
      {rows.length === 0 ? (
        <Empty>No open disputes.</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Issue</th>
                <th>Book</th>
                <th>Route</th>
                <th>Opened</th>
                <th>Status</th>
                <th>Assignee</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td className="mono small">
                    <Link href={`/disputes/${d.id}`}>{shortId(d.id)}</Link>
                  </td>
                  <td className="small">{DISPUTE_TYPES[d.issue_type]}</td>
                  <td className="small">
                    <Link href={`/admin/exchanges/${d.exchange_id}`}>{d.title}</Link>
                    <div className="tiny muted">by {d.opener}</div>
                  </td>
                  <td className="small nowrap">
                    {d.origin_country} → {d.destination_country}
                  </td>
                  <td className="small nowrap" title={fmtDateTime(d.created_at)}>
                    {relative(d.created_at)}
                  </td>
                  <td>
                    <Badge tone={d.status === "resolved" ? "ok" : d.status === "awaiting_info" ? "warn" : "danger"}>
                      {d.status.replace("_", " ")}
                      {d.outcome ? ` · ${d.outcome.replace(/_/g, " ")}` : ""}
                    </Badge>
                  </td>
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
