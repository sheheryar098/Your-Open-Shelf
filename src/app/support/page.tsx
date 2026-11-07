import Link from "next/link";
import { requireUser } from "@/shared/api/session";
import { ticketsFor } from "@/server/domain/support";
import { TICKET_CATEGORIES } from "@/shared/lib/vocab";
import { fmtDate, shortId } from "@/shared/lib/format";
import { Badge, Empty } from "@/shared/ui/primitives";

export const metadata = { title: "Support" };

export default async function SupportList() {
  const u = await requireUser("/support");
  const tickets = await ticketsFor(u.id);
  return (
    <div className="container narrow page">
      <div className="row-between">
        <h1 className="mb-0">Support tickets</h1>
        <Link href="/support/new" className="btn btn-primary">
          New ticket
        </Link>
      </div>
      <p className="muted">
        We aim to acknowledge standard tickets within 1 business day. <Link href="/help">Browse the help center</Link>
      </p>
      {tickets.length === 0 ? (
        <Empty>No tickets yet.</Empty>
      ) : (
        <div className="card">
          {tickets.map((t) => (
            <div key={t.id} className="list-item">
              <div className="body">
                <Link href={`/support/${t.id}`} className="title">
                  {t.subject}
                </Link>
                <div className="small muted">
                  #{shortId(t.id)} · {TICKET_CATEGORIES[t.category]} · updated {fmtDate(t.updated_at)}
                </div>
              </div>
              <Badge
                tone={
                  t.status === "awaiting_member"
                    ? "warn"
                    : t.status === "resolved" || t.status === "closed"
                      ? "ok"
                      : "info"
                }
              >
                {t.status.replace("_", " ")}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
