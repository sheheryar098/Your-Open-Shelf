import Link from "next/link";
import { requirePermission } from "@/shared/api/session";
import { allExchanges } from "@/server/domain/exchanges/queries";
import { countryName } from "@/shared/lib/countries";
import { EXCHANGE_STATUS_LABEL } from "@/shared/lib/vocab";
import { fmtDate, shortId } from "@/shared/lib/format";
import { ExchangeBadge } from "@/features/exchanges/components/ExchangeBadge";

export const metadata = { title: "Requests & exchanges" };

export default async function AdminExchanges({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  await requirePermission("exchanges.view");
  const sp = await searchParams;
  const rows = await allExchanges({ status: sp.status, q: sp.q, limit: 150 });
  return (
    <>
      <h1>Requests &amp; exchanges</h1>
      <form className="row">
        <input
          name="q"
          type="search"
          defaultValue={sp.q}
          placeholder="Title, member or exchange ID"
          aria-label="Search"
          style={{ flex: 1, minWidth: 200 }}
        />
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(EXCHANGE_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <button className="btn">Filter</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Book</th>
              <th>Sender → requester</th>
              <th>Route</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="mono small">
                  <Link href={`/admin/exchanges/${e.id}`}>{shortId(e.id)}</Link>
                </td>
                <td>{e.title}</td>
                <td className="small">
                  <Link href={`/admin/members/${e.sender_id}`}>{e.sender_name}</Link> →{" "}
                  <Link href={`/admin/members/${e.requester_id}`}>{e.requester_name}</Link>
                </td>
                <td className="small nowrap">
                  {countryName(e.origin_country)} → {countryName(e.destination_country)}
                </td>
                <td>
                  <ExchangeBadge status={e.status} />
                </td>
                <td className="small nowrap">{fmtDate(e.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
