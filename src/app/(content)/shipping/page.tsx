import { listCountries, enabledRoutes } from "@/domain/routes";
import { query } from "@/lib/db";
import { countryName, formatMoney } from "@/lib/countries";
import { chosenCountry } from "@/lib/geo";
import { currentUser } from "@/lib/auth/session";
import { Badge } from "@/components/ui";

export const metadata = { title: "Countries & shipping" };

const STATUS_LABEL: Record<string, string> = {
  open: "Open", limited: "Limited preview", waitlist: "Waitlist", unavailable: "Unavailable",
};

export default async function ShippingPage() {
  const [countries, routes, disabled, user, chosen] = await Promise.all([
    listCountries(),
    enabledRoutes(),
    query<{ origin_country: string; destination_country: string }>("SELECT origin_country, destination_country FROM shipping_routes WHERE NOT enabled ORDER BY 1, 2"),
    currentUser(),
    chosenCountry(),
  ]);
  const me = user?.country_code ?? chosen;
  const active = countries.filter((c) => c.status === "open" || c.status === "limited");
  const unavailable = countries.filter((c) => c.status === "unavailable");
  const mine = me ? countries.find((c) => c.code === me) : null;

  return (
    <div className="container page">
      <div className="narrow prose">
        <h1>Countries &amp; shipping</h1>
        <p className="lede">
          Anyone can browse YOS from anywhere. Exchanges run only on routes we&apos;ve checked for carriers, tracking, customs and
          support — and we expand route by route as delivery data shows they work well.
        </p>
        {mine && (
          <div className={`callout ${mine.status === "open" || mine.status === "limited" ? "" : "callout-warm"}`}>
            <p>
              <strong>{countryName(mine.code)}:</strong> {STATUS_LABEL[mine.status]}.{" "}
              {mine.status === "open" && "You can list, request and exchange books on the supported routes below."}
              {mine.status === "limited" && "You can list and request books on the approved routes below."}
              {mine.status === "waitlist" && "You can create an account and draft listings now; we'll let you know when exchanges open."}
              {mine.status === "unavailable" && (mine.status_note ?? "YOS can't operate exchanges here at the moment.")}
            </p>
          </div>
        )}

        <h2>Who pays postage?</h2>
        <p>
          The member sending the book pays the outgoing postage. The requester spends a credit and doesn&apos;t pay the sender
          anything. Postage is a real cost — check your carrier&apos;s prices before you accept, especially on international routes.
          Where YOS shows a postage figure, it&apos;s an <strong>indicative estimate</strong> set by our operations team, not a quote.
        </p>

        <h2>Tracking</h2>
        <p>
          Tracking is strongly recommended everywhere and required on cross-border routes. Where a route allows untracked post,
          senders must upload proof of postage, and delivery has to be confirmed by the recipient or support.
        </p>

        <h2>Customs on cross-border routes</h2>
        <ul>
          <li>The sender is responsible for an accurate, truthful customs declaration. Never misdeclare a book&apos;s contents or value.</li>
          <li>Duties, import taxes and clearance fees may be charged by the destination country and aren&apos;t covered by a YOS credit.</li>
          <li>Delivery can take longer and is less predictable. YOS can&apos;t promise delivery dates or “no customs fees”.</li>
        </ul>
      </div>

      <h2 style={{ marginTop: 32 }}>Supported routes</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>From</th><th>To</th><th>Typical delivery</th><th>Tracking</th><th>Indicative postage</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.id}>
                <td>{countryName(r.origin_country)}</td>
                <td>{countryName(r.destination_country)}</td>
                <td className="nowrap">{r.min_delivery_days != null ? `${r.min_delivery_days}–${r.max_delivery_days} days` : "—"}</td>
                <td>{r.tracking_required ? <Badge tone="info">Required</Badge> : <Badge>Recommended</Badge>}</td>
                <td className="nowrap">
                  {r.postage_estimate_min ? `${formatMoney(r.postage_estimate_min, r.postage_currency)}–${formatMoney(r.postage_estimate_max, r.postage_currency)}` : <span className="muted">Check carrier</span>}
                </td>
                <td className="small">
                  {r.origin_country !== r.destination_country && <Badge tone="warm">Customs</Badge>} {r.carrier_guidance}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {disabled.length > 0 && (
        <p className="small muted" style={{ marginTop: 12 }}>
          Being evaluated, not yet supported:{" "}
          {disabled.map((r) => `${countryName(r.origin_country)} → ${countryName(r.destination_country)}`).join(" · ")}
        </p>
      )}

      <div className="grid-2" style={{ marginTop: 28 }}>
        <div className="card card-flat">
          <h3>Exchanging now</h3>
          <ul>
            {active.map((c) => (
              <li key={c.code}>{countryName(c.code)} {c.status === "limited" && <Badge>Limited preview</Badge>}</li>
            ))}
          </ul>
        </div>
        <div className="card card-flat">
          <h3>Everywhere else</h3>
          <p>
            {countries.filter((c) => c.status === "waitlist").length} more countries are on the waitlist: you can join, browse and
            prepare listings, and we&apos;ll notify you when exchanges open.
          </p>
          {unavailable.length > 0 && (
            <>
              <p className="small"><strong>Currently unavailable:</strong></p>
              <ul className="small">
                {unavailable.map((c) => <li key={c.code}>{countryName(c.code)}{c.status_note ? ` — ${c.status_note}` : ""}</li>)}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
