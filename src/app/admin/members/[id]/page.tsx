import Link from "next/link";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requirePermission } from "@/shared/api/session";
import { getUser } from "@/server/domain/users";
import { getWallet, ledgerFor } from "@/server/domain/credits";
import { senderPerformance } from "@/server/domain/exchanges";
import { query } from "@/server/db";
import { can } from "@/server/rbac";
import { countryName } from "@/shared/lib/countries";
import { fmtDate, fmtDateTime } from "@/shared/lib/format";
import { LEDGER_LABEL } from "@/shared/lib/vocab";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { Badge } from "@/shared/ui/primitives";
import { ExchangeBadge } from "@/features/exchanges/components/ExchangeBadge";
import { accountStatusAction, adjustCreditsAction, restrictMemberAction, reverseLedgerAction, roleAction } from "@/features/admin/api/actions";

export const metadata = { title: "Member" };

export default async function AdminMember({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requirePermission("members.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const m = await getUser(id);
  if (!m) notFound();
  const [wallet, ledger, perf, exchanges, listings, reports, audits] = await Promise.all([
    getWallet(id),
    ledgerFor(id, { limit: 50 }).then((r) => r.rows),
    senderPerformance(id),
    query<{ id: string; status: string; title: string; role: string; updated_at: Date }>(
      `SELECT e.id, e.status, b.title, CASE WHEN e.sender_id = $1 THEN 'sender' ELSE 'requester' END AS role, e.updated_at
       FROM exchanges e JOIN listings l ON l.id = e.listing_id JOIN books b ON b.id = l.book_id
       WHERE e.sender_id = $1 OR e.requester_id = $1 ORDER BY e.updated_at DESC LIMIT 50`, [id]),
    query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM listings WHERE owner_id = $1 GROUP BY status", [id]),
    query<{ id: string; reason: string; status: string; created_at: Date }>("SELECT id, reason, status, created_at FROM reports WHERE target_type = 'member' AND target_id = $1 ORDER BY created_at DESC", [id]),
    query<{ action: string; reason: string | null; created_at: Date; actor: string | null }>(
      "SELECT a.action, a.reason, a.created_at, u.display_name AS actor FROM admin_audit_logs a LEFT JOIN users u ON u.id = a.actor_id WHERE a.target_type = 'user' AND a.target_id = $1 ORDER BY a.id DESC LIMIT 30", [id]),
  ]);
  const canAdjust = can(staff.role, "credits.adjust");
  return (
    <>
      <p className="small"><Link href="/admin/members">← Members</Link></p>
      <div className="row-between">
        <div>
          <h1 className="mb-0">{m.display_name}</h1>
          <div className="small muted">{m.email} · {m.country_code ? countryName(m.country_code) : "no country"} · joined {fmtDate(m.created_at)} · last sign-in {m.last_login_at ? fmtDateTime(m.last_login_at) : "never"}</div>
        </div>
        <div className="row">
          <Badge tone={m.status === "active" ? "ok" : "danger"}>{m.status}</Badge>
          <Badge tone="info">{m.role}</Badge>
          {m.email_verified_at ? <Badge tone="ok">verified</Badge> : <Badge tone="warn">unverified</Badge>}
          <Link className="btn btn-sm" href={`/members/${m.id}`}>Public profile</Link>
        </div>
      </div>
      {m.status_reason && <div className="alert alert-info">Status note: {m.status_reason}</div>}

      <div className="stats">
        <div className="stat stat-accent"><div className="v">{wallet.available}</div><div className="k">Available</div></div>
        <div className="stat"><div className="v">{wallet.reserved}</div><div className="k">Reserved</div></div>
        <div className="stat"><div className="v">{wallet.pending}</div><div className="k">Pending</div></div>
        <div className="stat"><div className="v">{perf.completed}</div><div className="k">Completed as sender</div></div>
        <div className="stat"><div className="v">{perf.senderCancelled}</div><div className="k">Sender cancellations / missed dispatch</div></div>
        <div className="stat"><div className="v">{listings.reduce((a, l) => a + l.n, 0)}</div><div className="k">Listings ({listings.map((l) => `${l.n} ${l.status}`).join(", ") || "none"})</div></div>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Restrictions</h2>
          <ActionForm action={restrictMemberAction.bind(null, m.id)}>
            <label className="check"><input type="checkbox" name="canList" defaultChecked={m.can_list} /> Can create and publish listings</label>
            <label className="check"><input type="checkbox" name="canRequest" defaultChecked={m.can_request} /> Can request books</label>
            <div className="field"><label htmlFor="rr">Reason (recorded, shown to member)</label><input id="rr" name="reason" type="text" required minLength={5} defaultValue={m.restriction_reason ?? ""} /></div>
            <SubmitButton className="btn btn-sm">Update restrictions</SubmitButton>
          </ActionForm>
        </section>
        {can(staff.role, "members.suspend") && (
          <section className="card">
            <h2>Account status</h2>
            <ActionForm action={accountStatusAction.bind(null, m.id, m.status === "suspended" ? "active" : "suspended")} confirm={m.status === "suspended" ? "Reinstate this account?" : "Suspend this account? They will be signed out and their listings paused."}>
              <div className="field"><label htmlFor="sr">Reason and evidence</label><textarea id="sr" name="reason" required minLength={5} rows={2} /></div>
              <SubmitButton className={m.status === "suspended" ? "btn btn-sm" : "btn btn-danger btn-sm"}>{m.status === "suspended" ? "Reinstate account" : "Suspend account"}</SubmitButton>
            </ActionForm>
            {can(staff.role, "members.roles") && (
              <ActionForm action={roleAction.bind(null, m.id)} className="form" >
                <hr />
                <div className="row">
                  <select name="role" defaultValue={m.role} aria-label="Role"><option value="member">Member</option><option value="moderator">Moderator</option><option value="admin">Admin</option></select>
                  <input name="reason" type="text" required minLength={5} placeholder="Reason" aria-label="Reason for role change" />
                  <SubmitButton className="btn btn-sm">Change role</SubmitButton>
                </div>
              </ActionForm>
            )}
          </section>
        )}
      </div>

      <section className="card">
        <div className="card-header"><h2>Credit ledger</h2><span className="small muted">Read-only history; corrections are new entries.</span></div>
        {canAdjust && (
          <ActionForm action={adjustCreditsAction.bind(null, m.id)} resetOnSuccess className="row">
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <input name="amount" type="number" min={-100} max={100} required placeholder="±n" aria-label="Amount" style={{ width: 90 }} />
            <input name="reason" type="text" required minLength={5} placeholder="Reason (required, shown to member)" aria-label="Reason" style={{ flex: 1, minWidth: 200 }} />
            <input name="exchangeId" type="text" placeholder="Linked exchange ID (optional)" aria-label="Linked exchange" style={{ width: 220 }} />
            <SubmitButton className="btn btn-sm btn-warm">Record adjustment</SubmitButton>
          </ActionForm>
        )}
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>When</th><th>Event</th><th>Reason</th><th className="num">Avail.</th><th className="num">Res.</th><th>By</th>{canAdjust && <th />}</tr></thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap small">{fmtDateTime(l.created_at)}</td>
                  <td className="small">{LEDGER_LABEL[l.event_type]}{l.exchange_id && <> · <Link href={`/admin/exchanges/${l.exchange_id}`}>exchange</Link></>}</td>
                  <td className="small">{l.reason}</td>
                  <td className="num">{l.available_delta || ""}</td>
                  <td className="num">{l.reserved_delta || ""}</td>
                  <td className="small">{l.actor_type}</td>
                  {canAdjust && (
                    <td>
                      {["credit_earned", "credit_admin_adjustment"].includes(l.event_type) && (
                        <details className="small">
                          <summary>Reverse</summary>
                          <ActionForm action={reverseLedgerAction.bind(null, l.id)} className="stack-sm" confirm="Reverse this ledger entry?">
                            <input name="reason" type="text" required minLength={5} placeholder="Reason" aria-label="Reason for reversal" />
                            <SubmitButton className="btn btn-sm btn-danger">Reverse</SubmitButton>
                          </ActionForm>
                        </details>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Exchange history</h2>
        {exchanges.map((e) => (
          <div key={e.id} className="list-item">
            <div className="body"><Link href={`/admin/exchanges/${e.id}`}>{e.title}</Link> <span className="small muted">as {e.role} · {fmtDate(e.updated_at)}</span></div>
            <ExchangeBadge status={e.status} />
          </div>
        ))}
        {exchanges.length === 0 && <p className="small muted">No exchanges.</p>}
      </section>

      <div className="grid-2">
        <section className="card card-flat">
          <h3>Reports about this member</h3>
          {reports.length === 0 ? <p className="small muted">None.</p> : reports.map((r) => <div key={r.id} className="small">{fmtDate(r.created_at)} · {r.reason} · {r.status}</div>)}
        </section>
        <section className="card card-flat">
          <h3>Staff actions</h3>
          {audits.length === 0 ? <p className="small muted">None.</p> : audits.map((a, i) => <div key={i} className="small">{fmtDateTime(a.created_at)} · {a.action} by {a.actor ?? "system"}{a.reason ? ` — ${a.reason}` : ""}</div>)}
        </section>
      </div>
    </>
  );
}
