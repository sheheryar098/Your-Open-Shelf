import { requirePermission } from "@/shared/api/session";
import { getRoute, listCountries } from "@/server/domain/routes";
import { routesWithPerformance } from "@/server/queries/admin";
import { countryName, formatPostageRange } from "@/shared/lib/countries";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { Badge } from "@/shared/ui/primitives";
import { countryAction } from "@/features/admin/api/actions";
import { RouteForm } from "@/features/admin/components/RouteForm";
import Link from "next/link";

export const metadata = { title: "Countries & routes" };

export default async function AdminCountries({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; o?: string; d?: string; q?: string }>;
}) {
  await requirePermission("routes.manage");
  const sp = await searchParams;
  const [countries, routes] = await Promise.all([listCountries(), routesWithPerformance()]);
  const editing = sp.o && sp.d ? await getRoute(sp.o, sp.d) : null;
  const visible = countries.filter(
    (c) =>
      c.status !== "waitlist" ||
      (sp.q && (c.name.toLowerCase().includes(sp.q.toLowerCase()) || c.code === sp.q.toUpperCase())),
  );

  return (
    <>
      <h1>Countries &amp; routes</h1>
      <section>
        <h2>Shipping routes</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Route</th>
                <th>Status</th>
                <th>Delivery</th>
                <th>Tracking</th>
                <th>Postage est.</th>
                <th>Risk</th>
                <th className="num">Exchanges</th>
                <th className="num">Disputed</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {routes.map(({ route: r, performance: p }) => {
                return (
                  <tr key={r.id}>
                    <td className="small">
                      {countryName(r.origin_country)} → {countryName(r.destination_country)}
                    </td>
                    <td>{r.enabled ? <Badge tone="ok">Enabled</Badge> : <Badge>Disabled</Badge>}</td>
                    <td className="small nowrap">
                      {r.min_delivery_days ?? "?"}–{r.max_delivery_days ?? "?"} d
                    </td>
                    <td className="small">
                      {r.tracking_required ? "required" : r.tracking_available ? "optional" : "none"}
                    </td>
                    <td className="small nowrap">{formatPostageRange(r) ?? "—"}</td>
                    <td className="small">{r.risk_level}</td>
                    <td className="num">{p?.total ?? 0}</td>
                    <td className="num">{p?.disputed ?? 0}</td>
                    <td>
                      <Link
                        href={`/admin/countries?o=${r.origin_country}&d=${r.destination_country}#route-form`}
                        className="btn btn-sm"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" id="route-form">
        <h2>
          {editing
            ? `Edit ${countryName(editing.origin_country)} → ${countryName(editing.destination_country)}`
            : "Add a route"}
        </h2>
        <RouteForm key={editing?.id ?? "new"} r={editing} origin={sp.o} destination={sp.d} />
      </section>
      <section>
        <div className="row-between">
          <h2 className="mb-0">Countries</h2>
          <form className="row">
            <input
              name="q"
              type="search"
              defaultValue={sp.q}
              placeholder="Find a waitlisted country"
              aria-label="Find country"
            />
            <button className="btn btn-sm">Find</button>
          </form>
        </div>
        <p className="small muted">
          Open: full exchange. Limited: accounts and listings, requests on approved routes. Waitlist: register interest
          only. Unavailable: no transactions, explain why.
        </p>
        <div className="stack">
          {visible.map((c) => (
            <details key={c.code} className="card card-flat">
              <summary>
                {countryName(c.code)}{" "}
                <Badge
                  tone={
                    c.status === "open"
                      ? "ok"
                      : c.status === "limited"
                        ? "info"
                        : c.status === "unavailable"
                          ? "danger"
                          : undefined
                  }
                >
                  {c.status}
                </Badge>
              </summary>
              <ActionForm action={countryAction.bind(null, c.code)}>
                <div className="field-row">
                  <div className="field">
                    <label>Status</label>
                    <select name="status" defaultValue={c.status}>
                      <option value="open">Open</option>
                      <option value="limited">Limited</option>
                      <option value="waitlist">Waitlist</option>
                      <option value="unavailable">Unavailable</option>
                    </select>
                  </div>
                  <div className="field">
                    <label>Currency</label>
                    <input name="currency" maxLength={3} defaultValue={c.currency ?? ""} />
                  </div>
                </div>
                <div className="field">
                  <label>Status note (public)</label>
                  <input
                    name="statusNote"
                    defaultValue={c.status_note ?? ""}
                    placeholder="e.g. why the country is unavailable"
                  />
                </div>
                <div className="field">
                  <label>Prohibited items notice (public)</label>
                  <textarea name="prohibited" rows={2} defaultValue={c.prohibited_items_notice ?? ""} />
                </div>
                <div className="row">
                  <input
                    name="reason"
                    required
                    minLength={5}
                    placeholder="Reason (audit log)"
                    aria-label="Reason"
                    style={{ flex: 1 }}
                  />
                  <SubmitButton className="btn btn-sm">Save</SubmitButton>
                </div>
              </ActionForm>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
