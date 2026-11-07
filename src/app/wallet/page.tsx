import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getWallet, ledgerFor } from "@/domain/credits";
import { LEDGER_LABEL } from "@/lib/vocab";
import { fmtDateTime } from "@/lib/format";
import { Empty } from "@/components/ui";

export const metadata = { title: "Credit wallet" };

export default async function WalletPage() {
  const u = await requireUser("/wallet");
  const [w, ledger] = await Promise.all([getWallet(u.id), ledgerFor(u.id, 200)]);
  return (
    <div className="container page stack-lg">
      <div>
        <h1>Credit wallet</h1>
        <p className="muted">YOS credits have no cash value and can only be used to request books. <Link href="/credits">How credits work</Link></p>
      </div>
      <div className="stats">
        <div className="stat stat-accent"><div className="v">{w.available}</div><div className="k">Available to spend</div></div>
        <div className="stat"><div className="v">{w.reserved}</div><div className="k">Reserved for your requests</div></div>
        <div className="stat"><div className="v">{w.pending}</div><div className="k">Pending from books you&apos;ve shipped</div></div>
        <div className="stat"><div className="v">{w.lifetimeEarned}</div><div className="k">Lifetime earned</div></div>
        <div className="stat"><div className="v">{w.lifetimeSpent}</div><div className="k">Lifetime spent</div></div>
      </div>
      <section>
        <h2>History</h2>
        {ledger.length === 0 ? (
          <Empty>No credit activity yet. You&apos;ll earn your first credit when a book you send completes. <Link href="/my/books/new">List a book</Link></Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Event</th><th>Reason</th><th>Exchange</th><th className="num">Available</th><th className="num">Reserved</th></tr>
              </thead>
              <tbody>
                {ledger.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap small">{fmtDateTime(e.created_at, u.timezone)}</td>
                    <td className="nowrap">{LEDGER_LABEL[e.event_type] ?? e.event_type}</td>
                    <td className="small">{e.reason}</td>
                    <td className="small">{e.exchange_id ? <Link href={`/exchanges/${e.exchange_id}`}>{e.book_title ?? "View"}</Link> : "—"}</td>
                    <td className={`num ${e.available_delta > 0 ? "pos" : e.available_delta < 0 ? "neg" : ""}`}>{e.available_delta ? (e.available_delta > 0 ? `+${e.available_delta}` : e.available_delta) : ""}</td>
                    <td className="num muted">{e.reserved_delta ? (e.reserved_delta > 0 ? `+${e.reserved_delta}` : e.reserved_delta) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 12 }}>
          Every movement is recorded with a reason. If something looks wrong, <Link href="/support/new?category=credit_balance">contact support</Link>.
        </p>
      </section>
    </div>
  );
}
