import { requirePermission } from "@/lib/auth/session";
import { getRoute, listCountries } from "@/domain/routes";
import { query } from "@/lib/db";
import { countryName, formatMoney } from "@/lib/countries";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, CountrySelect } from "@/components/ui";
import { countryAction, routeAction } from "@/app/actions/admin";
import type { ShippingRoute } from "@/domain/routes";
import Link from "next/link";

export const metadata = { title: "Countries & routes" };

function RouteForm({ r, origin, destination }: { r?: ShippingRoute | null; origin?: string; destination?: string }) {
  return (
    <ActionForm action={routeAction}>
      <div className="field-row">
        <div className="field"><label>From</label><CountrySelect name="origin" id={`o-${r?.id ?? "new"}`} defaultValue={r?.origin_country ?? origin} /></div>
        <div className="field"><label>To</label><CountrySelect name="destination" id={`d-${r?.id ?? "new"}`} defaultValue={r?.destination_country ?? destination} /></div>
        <div className="field"><label>Risk level</label>
          <select name="risk" defaultValue={r?.risk_level ?? "medium"}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
        </div>
      </div>
      <div className="row">
        <label className="check small"><input type="checkbox" name="enabled" defaultChecked={r?.enabled} /> Enabled</label>
        <label className="check small"><input type="checkbox" name="trackingAvailable" defaultChecked={r?.tracking_available ?? true} /> Tracking available</label>
        <label className="check small"><input type="checkbox" name="trackingRequired" defaultChecked={r?.tracking_required ?? true} /> Tracking required</label>
        <label className="check small"><input type="checkbox" name="customsRequired" defaultChecked={r?.customs_required} /> Customs documents required</label>
      </div>
      <div className="field-row">
        <div className="field"><label>Min delivery days</label><input name="minDays" type="number" min={0} defaultValue={r?.min_delivery_days ?? ""} /></div>
        <div className="field"><label>Max delivery days</label><input name="maxDays" type="number" min={0} defaultValue={r?.max_delivery_days ?? ""} /></div>
        <div className="field"><label>Max weight (g)</label><input name="maxWeight" type="number" min={1} defaultValue={r?.max_weight_grams ?? ""} /></div>
        <div className="field"><label>Postage estimate min</label><input name="postageMin" type="number" step="0.01" min={0} defaultValue={r?.postage_estimate_min ?? ""} /></div>
        <div className="field"><label>Postage estimate max</label><input name="postageMax" type="number" step="0.01" min={0} defaultValue={r?.postage_estimate_max ?? ""} /></div>
        <div className="field"><label>Currency</label><input name="postageCurrency" type="text" maxLength={3} defaultValue={r?.postage_currency ?? ""} placeholder="GBP" /></div>
      </div>
      <div className="field"><label>Carrier guidance</label><input name="carrierGuidance" type="text" defaultValue={r?.carrier_guidance ?? ""} /></div>
      <div className="field"><label>Customs notice (shown to members)</label><textarea name="customsNotice" rows={2} defaultValue={r?.customs_notice ?? ""} /></div>
      <div className="field-row">
        <div className="field"><label>Restricted content notes</label><input name="restricted" type="text" defaultValue={r?.restricted_content_notes ?? ""} /></div>
        <div className="field"><label>Support escalation notes (internal)</label><input name="supportNotes" type="text" defaultValue={r?.support_notes ?? ""} /></div>
      </div>
      <div className="row">
        <input name="reason" type="text" required minLength={5} placeholder="Reason for change (audit log)" aria-label="Reason" style={{ flex: 1, minWidth: 200 }} />
        <SubmitButton className="btn btn-sm">Save route</SubmitButton>
      </div>
      <p className="tiny muted">Only enable a route after carrier coverage, customs requirements and support procedures have been checked (§4.3). Postage estimates must come from real carrier services.</p>
    </ActionForm>
  );
}

export default async function AdminCountries({ searchParams }: { searchParams: Promise<{ edit?: string; o?: string; d?: string; q?: string }> }) {
  await requirePermission("routes.manage");
  const sp = await searchParams;
  const [countries, routes, perf] = await Promise.all([
    listCountries(),
    query<ShippingRoute>("SELECT * FROM shipping_routes ORDER BY enabled DESC, origin_country, destination_country"),
    query<{ route_id: string; total: number; completed: number; disputed: number }>(
      `SELECT route_id, count(*)::int AS total, count(*) FILTER (WHERE status = 'completed')::int AS completed,
         count(*) FILTER (WHERE id IN (SELECT exchange_id FROM disputes))::int AS disputed FROM exchanges GROUP BY route_id`,
    ),
  ]);
  const editing = sp.o && sp.d ? await getRoute(sp.o, sp.d) : null;
  const visible = countries.filter((c) => c.status !== "waitlist" || (sp.q && (c.name.toLowerCase().includes(sp.q.toLowerCase()) || c.code === sp.q.toUpperCase())));

  return (
    <>
      <h1>Countries &amp; routes</h1>
      <section>
        <h2>Shipping routes</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Route</th><th>Status</th><th>Delivery</th><th>Tracking</th><th>Postage est.</th><th>Risk</th><th className="num">Exchanges</th><th className="num">Disputed</th><th /></tr></thead>
            <tbody>
              {routes.map((r) => {
                const p = perf.find((x) => x.route_id === r.id);
                return (
                  <tr key={r.id}>
                    <td className="small">{countryName(r.origin_country)} → {countryName(r.destination_country)}</td>
                    <td>{r.enabled ? <Badge tone="ok">Enabled</Badge> : <Badge>Disabled</Badge>}</td>
                    <td className="small nowrap">{r.min_delivery_days ?? "?"}–{r.max_delivery_days ?? "?"} d</td>
                    <td className="small">{r.tracking_required ? "required" : r.tracking_available ? "optional" : "none"}</td>
                    <td className="small nowrap">{r.postage_estimate_min ? `${formatMoney(r.postage_estimate_min, r.postage_currency)}–${formatMoney(r.postage_estimate_max, r.postage_currency)}` : "—"}</td>
                    <td className="small">{r.risk_level}</td>
                    <td className="num">{p?.total ?? 0}</td>
                    <td className="num">{p?.disputed ?? 0}</td>
                    <td><Link href={`/admin/countries?o=${r.origin_country}&d=${r.destination_country}#route-form`} className="btn btn-sm">Edit</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" id="route-form">
        <h2>{editing ? `Edit ${countryName(editing.origin_country)} → ${countryName(editing.destination_country)}` : "Add a route"}</h2>
        <RouteForm key={editing?.id ?? "new"} r={editing} origin={sp.o} destination={sp.d} />
      </section>
      <section>
        <div className="row-between">
          <h2 className="mb-0">Countries</h2>
          <form className="row"><input name="q" type="search" defaultValue={sp.q} placeholder="Find a waitlisted country" aria-label="Find country" /><button className="btn btn-sm">Find</button></form>
        </div>
        <p className="small muted">Open: full exchange. Limited: accounts and listings, requests on approved routes. Waitlist: register interest only. Unavailable: no transactions — explain why.</p>
        <div className="stack">
          {visible.map((c) => (
            <details key={c.code} className="card card-flat">
              <summary>{countryName(c.code)} <Badge tone={c.status === "open" ? "ok" : c.status === "limited" ? "info" : c.status === "unavailable" ? "danger" : undefined}>{c.status}</Badge></summary>
              <ActionForm action={countryAction.bind(null, c.code)}>
                <div className="field-row">
                  <div className="field"><label>Status</label>
                    <select name="status" defaultValue={c.status}><option value="open">Open</option><option value="limited">Limited</option><option value="waitlist">Waitlist</option><option value="unavailable">Unavailable</option></select>
                  </div>
                  <div className="field"><label>Currency</label><input name="currency" maxLength={3} defaultValue={c.currency ?? ""} /></div>
                </div>
                <div className="field"><label>Status note (public)</label><input name="statusNote" defaultValue={c.status_note ?? ""} placeholder="e.g. why the country is unavailable" /></div>
                <div className="field"><label>Prohibited items notice (public)</label><textarea name="prohibited" rows={2} defaultValue={c.prohibited_items_notice ?? ""} /></div>
                <div className="row"><input name="reason" required minLength={5} placeholder="Reason (audit log)" aria-label="Reason" style={{ flex: 1 }} /><SubmitButton className="btn btn-sm">Save</SubmitButton></div>
              </ActionForm>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
