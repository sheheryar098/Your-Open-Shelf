import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/shared/api/session";
import { getExchangeForViewer } from "@/server/domain/exchanges";
import { query } from "@/server/db";
import { can } from "@/server/rbac";
import { countryName } from "@/shared/lib/countries";
import { DISPUTE_TYPES, EXCHANGE_STATUS_LABEL, LEDGER_LABEL } from "@/shared/lib/vocab";
import { fmtDateTime, shortId } from "@/shared/lib/format";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { ExchangeBadge } from "@/features/exchanges/components/ExchangeBadge";
import { exchangeInterventionAction } from "@/features/admin/api/actions";

export const metadata = { title: "Exchange (staff)" };

export default async function AdminExchange({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("exchanges.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getExchangeForViewer(id, staff);
  if (!data) notFound();
  const { exchange: e, shipment, events, messages, disputes, address, route } = data;
  const ledger = await query<{ id: string; user_id: string; event_type: string; available_delta: number; reserved_delta: number; reason: string; created_at: Date }>(
    "SELECT id, user_id, event_type, available_delta, reserved_delta, reason, created_at FROM credit_ledger WHERE exchange_id = $1 ORDER BY id",
    [id],
  );
  const canAct = can(staff.role, "exchanges.intervene");
  return (
    <>
      <p className="small"><Link href="/admin/exchanges">← Exchanges</Link></p>
      <div className="row-between">
        <div>
          <h1 className="mb-0">{e.title}</h1>
          <div className="small muted">
            #{shortId(e.id)} · <Link href={`/admin/members/${e.sender_id}`}>{e.sender_name}</Link> ({countryName(e.origin_country)}) → <Link href={`/admin/members/${e.requester_id}`}>{e.requester_name}</Link> ({countryName(e.destination_country)})
          </div>
        </div>
        <ExchangeBadge status={e.status} />
      </div>

      {canAct && (
        <section className="card" style={{ borderColor: "var(--warm)" }}>
          <h2>Intervene</h2>
          <ActionForm action={exchangeInterventionAction.bind(null, e.id)} confirm="Apply this action? It is recorded in the audit log.">
            <div className="field-row">
              <div className="field">
                <label htmlFor="op">Action</label>
                <select id="op" name="op" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {(e.status === "requested" || e.status === "accepted") && <option value="cancel">Cancel and return credit</option>}
                  {e.status === "shipped" && <option value="delivered_carrier">Mark delivered (carrier confirmation)</option>}
                  {e.status === "shipped" && <option value="delivered_support">Mark delivered (support verified)</option>}
                  {["requested", "accepted", "shipped", "delivered"].includes(e.status) && <option value="extend">Extend current deadline</option>}
                </select>
              </div>
              <div className="field"><label htmlFor="days">Days (for extensions)</label><input id="days" name="days" type="number" min={1} max={30} defaultValue={3} /></div>
            </div>
            <div className="field"><label htmlFor="reason">Reason</label><input id="reason" name="reason" type="text" required minLength={5} /></div>
            <SubmitButton className="btn btn-sm btn-warm">Apply</SubmitButton>
          </ActionForm>
          {disputes.length > 0 && (
            <p className="small" style={{ marginTop: 12 }}>
              Disputes: {disputes.map((d) => <Link key={d.id} href={`/disputes/${d.id}`} style={{ marginRight: 8 }}>{DISPUTE_TYPES[d.issue_type]} ({d.status})</Link>)}
            </p>
          )}
        </section>
      )}

      <div className="grid-2">
        <section className="card">
          <h3>Key dates</h3>
          <dl className="dl small">
            <dt>Requested</dt><dd>{fmtDateTime(e.requested_at)}</dd>
            <dt>Respond by</dt><dd>{fmtDateTime(e.respond_by)}</dd>
            {e.accepted_at && <><dt>Accepted</dt><dd>{fmtDateTime(e.accepted_at)}</dd></>}
            {e.dispatch_by && <><dt>Dispatch by</dt><dd>{fmtDateTime(e.dispatch_by)}</dd></>}
            {e.shipped_at && <><dt>Shipped</dt><dd>{fmtDateTime(e.shipped_at)}</dd></>}
            {e.auto_confirm_at && <><dt>Auto-confirm</dt><dd>{fmtDateTime(e.auto_confirm_at)}</dd></>}
            {e.delivered_at && <><dt>Delivered</dt><dd>{fmtDateTime(e.delivered_at)} ({e.delivery_confirmed_by})</dd></>}
            {e.completion_due_at && <><dt>Completion due</dt><dd>{fmtDateTime(e.completion_due_at)}</dd></>}
            {e.completed_at && <><dt>Completed</dt><dd>{fmtDateTime(e.completed_at)}</dd></>}
            {e.cancel_kind && <><dt>Cancel kind</dt><dd>{e.cancel_kind}</dd></>}
            <dt>Route risk</dt><dd>{route?.risk_level} · tracking {route?.tracking_required ? "required" : "optional"}</dd>
          </dl>
        </section>
        <section className="card">
          <h3>Shipment & address</h3>
          {shipment ? (
            <dl className="dl small">
              <dt>Carrier</dt><dd>{shipment.carrier}</dd>
              <dt>Tracking</dt><dd className="mono">{shipment.tracking_number ?? "—"}</dd>
              {shipment.tracking_url && <><dt>Link</dt><dd><a href={shipment.tracking_url} target="_blank" rel="noreferrer noopener">carrier page</a></dd></>}
              <dt>Dispatch date</dt><dd>{shipment.dispatch_date}</dd>
              {shipment.proof_file_id && <><dt>Proof</dt><dd><a href={`/files/${shipment.proof_file_id}`} target="_blank" rel="noreferrer">view</a></dd></>}
            </dl>
          ) : <p className="small muted">Not shipped.</p>}
          {address && (
            <details className="small" style={{ marginTop: 8 }}>
              <summary>Delivery address (access is for case handling only)</summary>
              <p style={{ whiteSpace: "pre-line" }}>{[address.recipient_name, address.line1, address.line2, address.city, address.region, address.postal_code, countryName(address.country_code)].filter(Boolean).join("\n")}</p>
              {address.redacted_at && <p className="muted">Redacted {fmtDateTime(address.redacted_at)}</p>}
            </details>
          )}
        </section>
      </div>

      <section className="card">
        <h3>Credit movements for this exchange</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Member</th><th>Event</th><th className="num">Avail.</th><th className="num">Res.</th><th>Reason</th></tr></thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id}>
                  <td className="small nowrap">{fmtDateTime(l.created_at)}</td>
                  <td className="small">{l.user_id === e.sender_id ? "sender" : "requester"}</td>
                  <td className="small">{LEDGER_LABEL[l.event_type]}</td>
                  <td className="num">{l.available_delta || ""}</td>
                  <td className="num">{l.reserved_delta || ""}</td>
                  <td className="small">{l.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2">
        <section className="card card-flat">
          <h3>Timeline</h3>
          <ul className="timeline">
            {events.map((ev, i) => (
              <li key={i}><strong>{EXCHANGE_STATUS_LABEL[ev.to_status] ?? ev.to_status}</strong> <span className="tiny muted">{fmtDateTime(ev.created_at)} · {ev.actor_type}</span>{ev.note && <div className="small">{ev.note}</div>}</li>
            ))}
          </ul>
        </section>
        <section className="card card-flat">
          <h3>Messages</h3>
          {messages.length === 0 ? <p className="small muted">None.</p> : (
            <div className="messages">
              {messages.map((m) => <div key={m.id} className="msg"><div className="who">{m.sender_name} · {fmtDateTime(m.created_at)}</div>{m.body}</div>)}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
