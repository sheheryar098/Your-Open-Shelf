import Link from "next/link";
import { requireUser } from "@/shared/api/session";
import { runJobsIfDue } from "@/server/jobs/runner";
import { exchangesFor } from "@/server/domain/exchanges/queries";
import { getWallet } from "@/server/domain/credits";
import { listingCountsByStatus, recentWishlistMatches } from "@/server/queries/member";
import { getCountry } from "@/server/domain/routes";
import { countryName } from "@/shared/lib/countries";
import { relative } from "@/shared/lib/format";
import { ExchangeList } from "@/features/exchanges/components/ExchangeList";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const u = await requireUser("/dashboard");
  await runJobsIfDue();
  const [wallet, outgoing, incoming, matches, listingCounts, country] = await Promise.all([
    getWallet(u.id),
    exchangesFor(u.id, "sender"),
    exchangesFor(u.id, "requester"),
    recentWishlistMatches(u.id),
    listingCountsByStatus(u.id),
    u.country_code ? getCountry(u.country_code) : null,
  ]);
  const count = (s: string) => listingCounts[s] ?? 0;
  const toRespond = outgoing.filter((e) => e.status === "requested");
  const toShip = outgoing.filter((e) => e.status === "accepted");
  const inTransitOut = outgoing.filter((e) => ["shipped", "delivered", "disputed"].includes(e.status));
  const incomingLive = incoming.filter((e) =>
    ["requested", "accepted", "shipped", "delivered", "disputed"].includes(e.status),
  );
  const toConfirm = incoming.filter((e) => e.status === "shipped" || e.status === "delivered");

  return (
    <div className="container page stack-lg">
      <div className="row-between">
        <h1 className="mb-0">Hello, {u.display_name}</h1>
        <div className="row">
          <Link href="/my/books/new" className="btn btn-primary">
            List a book
          </Link>
          <Link href="/explore" className="btn">
            Find a book
          </Link>
        </div>
      </div>

      {!u.email_verified_at && (
        <div className="alert alert-warn">
          Verify your email to list and request books. <Link href="/verify-email">Resend the link</Link>
        </div>
      )}
      {country && !["open", "limited"].includes(country.status) && (
        <div className="alert alert-info">
          Exchanges aren&apos;t open in {countryName(country.code)} yet. You can browse and draft listings, and
          we&apos;ll let you know when it opens.
        </div>
      )}
      {(!u.can_list || !u.can_request) && (
        <div className="alert alert-warn">
          Some actions on your account are restricted{u.restriction_reason ? `: ${u.restriction_reason}` : ""}.{" "}
          <Link href="/support/new">Contact support</Link>
        </div>
      )}

      <div className="stats">
        <Link href="/wallet" className="stat stat-accent">
          <div className="v">{wallet.available}</div>
          <div className="k">Available credits</div>
        </Link>
        <Link href="/wallet" className="stat">
          <div className="v">{wallet.pending}</div>
          <div className="k">Pending credits</div>
        </Link>
        <Link href="/wallet" className="stat">
          <div className="v">{wallet.reserved}</div>
          <div className="k">Reserved credits</div>
        </Link>
        <Link href="/my/books" className="stat">
          <div className="v">{count("active") + count("reserved")}</div>
          <div className="k">Books on your shelf</div>
        </Link>
      </div>

      {(toRespond.length > 0 || toShip.length > 0 || toConfirm.length > 0) && (
        <section>
          <h2>Needs your attention</h2>
          <div className="stack">
            {toRespond.length > 0 && (
              <>
                <h3>Requests waiting for your response</h3>
                <ExchangeList items={toRespond} side="sender" empty="" />
              </>
            )}
            {toShip.length > 0 && (
              <>
                <h3>Books to ship</h3>
                <ExchangeList items={toShip} side="sender" empty="" />
              </>
            )}
            {toConfirm.length > 0 && (
              <>
                <h3>Books on their way to you</h3>
                <ExchangeList items={toConfirm} side="requester" empty="" />
              </>
            )}
          </div>
        </section>
      )}

      <div className="grid-2">
        <section>
          <div className="row-between">
            <h2 className="mb-0">Incoming books</h2>
            <Link href="/my/requests" className="small">
              All requests →
            </Link>
          </div>
          <div style={{ marginTop: 12 }}>
            <ExchangeList
              items={incomingLive.slice(0, 5)}
              side="requester"
              empty={
                <>
                  No requests in progress. <Link href="/explore">Find your next read</Link>.
                </>
              }
            />
          </div>
        </section>
        <section>
          <div className="row-between">
            <h2 className="mb-0">Books you&apos;ve sent</h2>
            <Link href="/my/shipments" className="small">
              All shipments →
            </Link>
          </div>
          <div style={{ marginTop: 12 }}>
            <ExchangeList
              items={inTransitOut.slice(0, 5)}
              side="sender"
              empty={<>Nothing in transit. Books you ship will appear here until you earn the credit.</>}
            />
          </div>
        </section>
      </div>

      {matches.length > 0 && (
        <section className="card">
          <h2>Wish-list matches</h2>
          {matches.map((m) => (
            <div key={m.id} className="list-item">
              <div className="body">{m.link ? <Link href={m.link}>{m.title}</Link> : m.title}</div>
              <span className="small muted">{relative(m.created_at)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
