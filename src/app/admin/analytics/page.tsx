import { requirePermission } from "@/shared/api/session";
import { kpis } from "@/server/domain/analytics";
import { countryName } from "@/shared/lib/countries";
import { formatHours } from "@/shared/lib/format";

export const metadata = { title: "Analytics" };

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

export default async function Analytics() {
  await requirePermission("analytics.view");
  const k = await kpis();
  const f = k.funnel;
  const max = Math.max(1, ...k.monthly.map((m) => Math.max(m.completed, m.requested)));
  return (
    <>
      <h1>Analytics</h1>
      <section className="card">
        <h2>North star: successful exchanges per month</h2>
        <p className="small muted">Completed exchanges with no unresolved dispute. Requests shown for comparison.</p>
        <div className="bar-chart" role="table" aria-label="Successful exchanges per month">
          {k.monthly.map((m) => (
            <div key={m.month} className="r" role="row">
              <span role="cell" className="muted">
                {m.month}
              </span>
              <span role="cell" style={{ display: "grid", gap: 3 }}>
                <span
                  className="bar"
                  style={{ width: `${(m.completed / max) * 100}%` }}
                  title={`${m.completed} completed`}
                />
                <span
                  className="bar"
                  style={{ width: `${(m.requested / max) * 100}%`, background: "var(--line-2)", height: 6 }}
                  title={`${m.requested} requested`}
                />
              </span>
              <span role="cell" className="num">
                <strong>{m.completed}</strong> <span className="tiny muted">/ {m.requested}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Marketplace health (last 90 days)</h2>
        <div className="stats">
          <div className="stat">
            <div className="v">{f.total}</div>
            <div className="k">Requests</div>
          </div>
          <div className="stat">
            <div className="v">{pct(f.accepted, f.responded)}</div>
            <div className="k">Acceptance rate (of responded)</div>
          </div>
          <div className="stat">
            <div className="v">{pct(f.shipped_on_time, f.shipped)}</div>
            <div className="k">Dispatched on time</div>
          </div>
          <div className="stat">
            <div className="v">{pct(f.completed, f.shipped)}</div>
            <div className="k">Shipped → completed</div>
          </div>
          <div className="stat">
            <div className="v">{pct(f.disputed, f.shipped)}</div>
            <div className="k">Dispute rate (of shipped)</div>
          </div>
          <div className="stat">
            <div className="v">{formatHours(f.median_dispatch_hours)}</div>
            <div className="k">Median acceptance → dispatch</div>
          </div>
          <div className="stat">
            <div className="v">{formatHours(k.medianListingToRequestHours)}</div>
            <div className="k">Median listing → first request</div>
          </div>
          <div className="stat">
            <div className="v">{pct(k.participation.both, k.participation.members)}</div>
            <div className="k">Members who both sent and received</div>
          </div>
        </div>
      </section>

      <section>
        <h2>Trust</h2>
        <div className="stats">
          <div className="stat">
            <div className="v">{k.trust.disputes_90d}</div>
            <div className="k">Disputes (90d)</div>
          </div>
          <div className="stat">
            <div className="v">{k.trust.non_delivery_90d}</div>
            <div className="k">Non-delivery disputes</div>
          </div>
          <div className="stat">
            <div className="v">{k.trust.misdescription_90d}</div>
            <div className="k">Damage / misdescription</div>
          </div>
          <div className="stat">
            <div className="v">{k.trust.reports_90d}</div>
            <div className="k">Reports (90d)</div>
          </div>
          <div className="stat">
            <div className="v">{formatHours(k.trust.avg_resolution_hours || null)}</div>
            <div className="k">Avg. dispute resolution</div>
          </div>
          <div className="stat">
            <div className="v">{k.trust.avg_rating ? k.trust.avg_rating.toFixed(2) : "—"}</div>
            <div className="k">Average rating</div>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section>
          <h2>Routes</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Route</th>
                  <th className="num">Total</th>
                  <th className="num">Completed</th>
                  <th className="num">Disputed</th>
                  <th className="num">Avg. delivery</th>
                </tr>
              </thead>
              <tbody>
                {k.routes.map((r) => (
                  <tr key={r.origin + r.destination}>
                    <td className="small">
                      {countryName(r.origin)} → {countryName(r.destination)}
                    </td>
                    <td className="num">{r.total}</td>
                    <td className="num">{r.completed}</td>
                    <td className="num">{pct(r.disputed, r.total)}</td>
                    <td className="num">{r.avg_delivery_days ? `${r.avg_delivery_days.toFixed(1)} d` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h2>Countries</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Country</th>
                  <th className="num">Active members</th>
                  <th className="num">Active listings</th>
                </tr>
              </thead>
              <tbody>
                {k.countries.map((c) => (
                  <tr key={c.code}>
                    <td className="small">{countryName(c.code)}</td>
                    <td className="num">{c.members}</td>
                    <td className="num">{c.listings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
