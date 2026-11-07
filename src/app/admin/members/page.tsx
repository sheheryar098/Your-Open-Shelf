import Link from "next/link";
import { requirePermission } from "@/shared/api/session";
import { searchMembers } from "@/server/queries/admin";
import { countryName } from "@/shared/lib/countries";
import { fmtDate } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/primitives";

export const metadata = { title: "Members" };

export default async function AdminMembers({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  await requirePermission("members.view");
  const { q, status } = await searchParams;
  const rows = await searchMembers({ q, status });
  return (
    <>
      <h1>Members</h1>
      <form className="row">
        <input
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Name, email or ID"
          aria-label="Search members"
          style={{ flex: 1, minWidth: 200 }}
        />
        <select name="status" defaultValue={status ?? ""} aria-label="Status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="closed">Closed</option>
        </select>
        <button className="btn">Search</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Country</th>
              <th>Joined</th>
              <th>Status</th>
              <th className="num">Credits</th>
              <th className="num">Completed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/members/${r.id}`}>{r.display_name}</Link>
                  <div className="tiny muted">{r.email}</div>
                </td>
                <td>{r.country_code ? countryName(r.country_code) : "—"}</td>
                <td className="nowrap">{fmtDate(r.created_at)}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <Badge tone={r.status === "active" ? "ok" : "danger"}>{r.status}</Badge>
                    {r.role !== "member" && <Badge tone="info">{r.role}</Badge>}
                    {!r.email_verified_at && <Badge tone="warn">unverified</Badge>}
                    {(!r.can_list || !r.can_request) && <Badge tone="warn">restricted</Badge>}
                  </div>
                </td>
                <td className="num">{r.available}</td>
                <td className="num">{r.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
