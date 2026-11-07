import Link from "next/link";
import { requirePermission } from "@/shared/api/session";
import { reconcile } from "@/server/domain/credits";
import { creditOverview } from "@/server/queries/admin";
import { LEDGER_LABEL } from "@/shared/lib/vocab";
import { fmtDateTime } from "@/shared/lib/format";

export const metadata = { title: "Credit ledger" };

export default async function AdminCredits({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requirePermission("credits.view");
  const { type } = await searchParams;
  const [mismatches, overview] = await Promise.all([reconcile(), creditOverview(type)]);
  const { totals, recent, repeatPairs: unusual, outstanding } = overview;
  return (
    <>
      <div className="row-between">
        <h1 className="mb-0">Credit ledger</h1>
        <a className="btn btn-sm" href="/admin/credits/export">
          Export reconciliation CSV
        </a>
      </div>
      {mismatches.length === 0 ? (
        <div className="alert alert-ok">
          Reconciliation passed: every wallet summary matches the sum of its ledger events.
        </div>
      ) : (
        <div className="alert alert-error">
          {mismatches.length} account(s) don&apos;t match the ledger:{" "}
          {mismatches.map((m) => (
            <Link key={m.user_id} href={`/admin/members/${m.user_id}`} style={{ marginRight: 8 }}>
              {m.user_id.slice(0, 8)}
            </Link>
          ))}
        </div>
      )}
      <div className="stats">
        <div className="stat">
          <div className="v">{outstanding?.available ?? 0}</div>
          <div className="k">Available across all wallets</div>
        </div>
        <div className="stat">
          <div className="v">{outstanding?.reserved ?? 0}</div>
          <div className="k">Reserved for live requests</div>
        </div>
        {totals.map((t) => (
          <Link key={t.event_type} href={`/admin/credits?type=${t.event_type}`} className="stat">
            <div className="v">{t.n}</div>
            <div className="k">{LEDGER_LABEL[t.event_type]} events</div>
          </Link>
        ))}
      </div>
      {unusual.length > 0 && (
        <section className="card" style={{ borderColor: "var(--warn)" }}>
          <h2>Patterns to review</h2>
          <p className="small muted">
            Pairs of members with 3+ completed exchanges in 90 days. Often legitimate (friends, book clubs), review
            before acting.
          </p>
          {unusual.map((u) => (
            <div key={u.sender_id + u.requester_id} className="small">
              <Link href={`/admin/members/${u.sender_id}`}>{u.sender}</Link> →{" "}
              <Link href={`/admin/members/${u.requester_id}`}>{u.requester}</Link>: {u.n} exchanges
            </div>
          ))}
        </section>
      )}
      <section>
        <div className="row-between">
          <h2 className="mb-0">Recent events{type ? `: ${LEDGER_LABEL[type]}` : ""}</h2>
          {type && <Link href="/admin/credits">Show all</Link>}
        </div>
        <p className="small muted">
          The ledger is append-only. Make corrections from a member&apos;s page; every adjustment needs a reason.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>When</th>
                <th>Member</th>
                <th>Event</th>
                <th className="num">Avail.</th>
                <th className="num">Res.</th>
                <th>Reason</th>
                <th>Actor</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((l) => (
                <tr key={l.id}>
                  <td className="mono small">{l.id}</td>
                  <td className="small nowrap">{fmtDateTime(l.created_at)}</td>
                  <td className="small">
                    <Link href={`/admin/members/${l.user_id}`}>{l.display_name}</Link>
                  </td>
                  <td className="small">
                    {LEDGER_LABEL[l.event_type]}
                    {l.exchange_id && (
                      <>
                        {" "}
                        · <Link href={`/admin/exchanges/${l.exchange_id}`}>exch.</Link>
                      </>
                    )}
                  </td>
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
