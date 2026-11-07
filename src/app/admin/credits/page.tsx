import Link from "next/link";
import { requirePermission } from "@/shared/api/session";
import { reconcile } from "@/server/domain/credits";
import { query, queryOne } from "@/server/db";
import { LEDGER_LABEL } from "@/shared/lib/vocab";
import { fmtDateTime } from "@/shared/lib/format";

export const metadata = { title: "Credit ledger" };

export default async function AdminCredits({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requirePermission("credits.view");
  const { type } = await searchParams;
  const [mismatches, totals, recent, unusual] = await Promise.all([
    reconcile(),
    query<{ event_type: string; n: number; available: number; reserved: number }>(
      "SELECT event_type, count(*)::int AS n, sum(available_delta)::int AS available, sum(reserved_delta)::int AS reserved FROM credit_ledger GROUP BY 1 ORDER BY 1",
    ),
    query<{ id: string; user_id: string; display_name: string; event_type: string; available_delta: number; reserved_delta: number; reason: string; actor_type: string; actor_name: string | null; exchange_id: string | null; created_at: Date }>(
      `SELECT l.id, l.user_id, u.display_name, l.event_type, l.available_delta, l.reserved_delta, l.reason, l.actor_type, a.display_name AS actor_name, l.exchange_id, l.created_at
       FROM credit_ledger l JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.actor_id
       ${type ? "WHERE l.event_type = $1" : ""} ORDER BY l.id DESC LIMIT 100`,
      type ? [type] : [],
    ),
    // Simple credit-farming signal (§12.2): members earning from the same counterpart repeatedly.
    query<{ sender_id: string; sender: string; requester_id: string; requester: string; n: number }>(
      `SELECT e.sender_id, s.display_name AS sender, e.requester_id, r.display_name AS requester, count(*)::int AS n
       FROM exchanges e JOIN users s ON s.id = e.sender_id JOIN users r ON r.id = e.requester_id
       WHERE e.status = 'completed' AND e.completed_at > now() - interval '90 days'
       GROUP BY 1, 2, 3, 4 HAVING count(*) >= 3 ORDER BY n DESC LIMIT 20`,
    ),
  ]);
  const outstanding = await queryOne<{ available: number; reserved: number }>("SELECT coalesce(sum(available),0)::int AS available, coalesce(sum(reserved),0)::int AS reserved FROM credit_accounts");
  return (
    <>
      <div className="row-between">
        <h1 className="mb-0">Credit ledger</h1>
        <a className="btn btn-sm" href="/admin/credits/export">Export reconciliation CSV</a>
      </div>
      {mismatches.length === 0 ? (
        <div className="alert alert-ok">Reconciliation passed: every wallet summary matches the sum of its ledger events.</div>
      ) : (
        <div className="alert alert-error">
          {mismatches.length} account(s) don&apos;t match the ledger:{" "}
          {mismatches.map((m) => <Link key={m.user_id} href={`/admin/members/${m.user_id}`} style={{ marginRight: 8 }}>{m.user_id.slice(0, 8)}</Link>)}
        </div>
      )}
      <div className="stats">
        <div className="stat"><div className="v">{outstanding?.available ?? 0}</div><div className="k">Available across all wallets</div></div>
        <div className="stat"><div className="v">{outstanding?.reserved ?? 0}</div><div className="k">Reserved for live requests</div></div>
        {totals.map((t) => (
          <Link key={t.event_type} href={`/admin/credits?type=${t.event_type}`} className="stat">
            <div className="v">{t.n}</div><div className="k">{LEDGER_LABEL[t.event_type]} events</div>
          </Link>
        ))}
      </div>
      {unusual.length > 0 && (
        <section className="card" style={{ borderColor: "var(--warn)" }}>
          <h2>Patterns to review</h2>
          <p className="small muted">Pairs of members with 3+ completed exchanges in 90 days. Often legitimate (friends, book clubs) — review before acting.</p>
          {unusual.map((u) => (
            <div key={u.sender_id + u.requester_id} className="small">
              <Link href={`/admin/members/${u.sender_id}`}>{u.sender}</Link> → <Link href={`/admin/members/${u.requester_id}`}>{u.requester}</Link>: {u.n} exchanges
            </div>
          ))}
        </section>
      )}
      <section>
        <div className="row-between"><h2 className="mb-0">Recent events{type ? ` — ${LEDGER_LABEL[type]}` : ""}</h2>{type && <Link href="/admin/credits">Show all</Link>}</div>
        <p className="small muted">The ledger is append-only. Make corrections from a member&apos;s page; every adjustment needs a reason.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>When</th><th>Member</th><th>Event</th><th className="num">Avail.</th><th className="num">Res.</th><th>Reason</th><th>Actor</th></tr></thead>
            <tbody>
              {recent.map((l) => (
                <tr key={l.id}>
                  <td className="mono small">{l.id}</td>
                  <td className="small nowrap">{fmtDateTime(l.created_at)}</td>
                  <td className="small"><Link href={`/admin/members/${l.user_id}`}>{l.display_name}</Link></td>
                  <td className="small">{LEDGER_LABEL[l.event_type]}{l.exchange_id && <> · <Link href={`/admin/exchanges/${l.exchange_id}`}>exch.</Link></>}</td>
                  <td className="num">{l.available_delta || ""}</td>
                  <td className="num">{l.reserved_delta || ""}</td>
                  <td className="small">{l.reason}</td>
                  <td className="small">{l.actor_name ?? l.actor_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
