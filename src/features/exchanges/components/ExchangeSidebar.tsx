import Link from "next/link";
import type { ExchangeView } from "@/server/domain/exchanges/queries";
import { fmtDate, fmtDateTime } from "@/shared/lib/format";
import { EXCHANGE_STATUS_LABEL } from "@/shared/lib/vocab";

const ACTOR_LABEL: Record<string, string> = {
  system: "YOS (automatic)",
  staff: "YOS support",
  member: "member",
};

export function ExchangeSidebar({ view, timeZone }: { view: ExchangeView; timeZone: string }) {
  const { exchange: e, shipment, route, events } = view;
  const at = (d: Date | null) => fmtDateTime(d, timeZone);

  return (
    <aside className="stack">
      {shipment && (
        <section className="card">
          <h3>Shipment</h3>
          <dl className="dl">
            <dt>Carrier</dt>
            <dd>{shipment.carrier}</dd>
            <dt>Dispatched</dt>
            <dd>{fmtDate(shipment.dispatch_date)}</dd>
            <dt>Tracking</dt>
            <dd>
              {shipment.tracking_number ? (
                <span className="mono">{shipment.tracking_number}</span>
              ) : (
                <span className="muted">Untracked</span>
              )}
            </dd>
            {shipment.proof_file_id && (
              <>
                <dt>Proof</dt>
                <dd>
                  <a href={`/files/${shipment.proof_file_id}`} target="_blank" rel="noreferrer">
                    Proof of postage
                  </a>
                </dd>
              </>
            )}
          </dl>
          {shipment.tracking_url && (
            <a
              href={shipment.tracking_url}
              target="_blank"
              rel="noreferrer noopener"
              className="btn btn-sm"
              style={{ marginTop: 12 }}
            >
              Open carrier tracking ↗
            </a>
          )}
        </section>
      )}

      <section className="card">
        <h3>Details</h3>
        <dl className="dl small">
          <dt>Requested</dt>
          <dd>{at(e.requested_at)}</dd>
          {e.accepted_at && (
            <>
              <dt>Accepted</dt>
              <dd>{at(e.accepted_at)}</dd>
            </>
          )}
          {e.status === "accepted" && e.dispatch_by && (
            <>
              <dt>Ship by</dt>
              <dd>{at(e.dispatch_by)}</dd>
            </>
          )}
          {e.shipped_at && (
            <>
              <dt>Shipped</dt>
              <dd>{at(e.shipped_at)}</dd>
            </>
          )}
          {e.delivered_at && (
            <>
              <dt>Delivered</dt>
              <dd>{at(e.delivered_at)}</dd>
            </>
          )}
          {e.completed_at && (
            <>
              <dt>Completed</dt>
              <dd>{at(e.completed_at)}</dd>
            </>
          )}
          {route?.min_delivery_days != null && (
            <>
              <dt>Typical delivery</dt>
              <dd>
                {route.min_delivery_days} to {route.max_delivery_days} days
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className="card card-flat">
        <h3>Timeline</h3>
        <ul className="timeline">
          {events.map((event, i) => (
            <li key={i}>
              <strong>{EXCHANGE_STATUS_LABEL[event.to_status] ?? event.to_status}</strong>
              <div className="tiny muted">
                {at(event.created_at)} · {ACTOR_LABEL[event.actor_type] ?? event.actor_type}
              </div>
              {event.note && <div className="small">{event.note}</div>}
            </li>
          ))}
        </ul>
      </section>

      <p className="small">
        <Link href={`/support/new?exchange=${e.id}`}>Get help with this exchange</Link>
      </p>
    </aside>
  );
}
