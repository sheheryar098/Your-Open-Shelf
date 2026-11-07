import Link from "next/link";
import type { ExchangeSummary } from "@/domain/exchanges";
import { countryName } from "@/lib/countries";
import { fmtDate, relative } from "@/lib/format";
import { BookMedia, Empty, ExchangeBadge } from "./ui";

function deadline(e: ExchangeSummary, side: "requester" | "sender") {
  if (e.status === "requested") return side === "sender" ? `Respond ${relative(e.respond_by)}` : `Sender responds by ${fmtDate(e.respond_by)}`;
  if (e.status === "accepted" && e.dispatch_by) return side === "sender" ? `Ship ${relative(e.dispatch_by)}` : `Dispatch due by ${fmtDate(e.dispatch_by)}`;
  if (e.status === "shipped") return side === "requester" ? "Confirm when it arrives" : `Shipped ${fmtDate(e.shipped_at)}`;
  if (e.status === "delivered" && e.completion_due_at) return `Completes ${relative(e.completion_due_at)} unless a problem is reported`;
  if (e.completed_at) return `Completed ${fmtDate(e.completed_at)}`;
  if (e.closed_at) return `Closed ${fmtDate(e.closed_at)}`;
  return "";
}

export function ExchangeList({ items, side, empty }: { items: ExchangeSummary[]; side: "requester" | "sender"; empty: React.ReactNode }) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="card">
      {items.map((e) => (
        <div key={e.id} className="list-item">
          <div className="thumb"><BookMedia title={e.title} authors={e.authors} photoId={e.photo_id} /></div>
          <div className="body">
            <Link href={`/exchanges/${e.id}`} className="title">{e.title}</Link>
            <div className="small muted">
              {side === "requester" ? `From ${e.sender_name} in ${countryName(e.origin_country)}` : `To ${e.requester_name} in ${countryName(e.destination_country)}`}
            </div>
            <div className="small">{deadline(e, side)}</div>
          </div>
          <ExchangeBadge status={e.status} />
        </div>
      ))}
    </div>
  );
}
