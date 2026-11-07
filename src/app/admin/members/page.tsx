import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { query } from "@/lib/db";
import { countryName } from "@/lib/countries";
import { fmtDate } from "@/lib/format";
import { Badge } from "@/components/ui";

export const metadata = { title: "Members" };

export default async function AdminMembers({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requirePermission("members.view");
  const { q, status } = await searchParams;
  const params: unknown[] = [];
  const where = ["true"];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(u.email) LIKE $${params.length} OR lower(u.display_name) LIKE $${params.length} OR u.id::text = $${params.length + 1})`);
    params.push(q);
  }
  if (status) {
    params.push(status);
    where.push(`u.status = $${params.length}`);
  }
  const rows = await query<{ id: string; email: string; display_name: string; role: string; status: string; country_code: string | null; created_at: Date; email_verified_at: Date | null; can_list: boolean; can_request: boolean; available: number; completed: number }>(
    `SELECT u.id, u.email, u.display_name, u.role, u.status, u.country_code, u.created_at, u.email_verified_at, u.can_list, u.can_request,
       coalesce(a.available, 0) AS available,
       (SELECT count(*)::int FROM exchanges e WHERE (e.sender_id = u.id OR e.requester_id = u.id) AND e.status = 'completed') AS completed
     FROM users u LEFT JOIN credit_accounts a ON a.user_id = u.id
     WHERE ${where.join(" AND ")} ORDER BY u.created_at DESC LIMIT 100`,
    params,
  );
  return (
    <>
      <h1>Members</h1>
      <form className="row">
        <input name="q" type="search" defaultValue={q} placeholder="Name, email or ID" aria-label="Search members" style={{ flex: 1, minWidth: 200 }} />
        <select name="status" defaultValue={status ?? ""} aria-label="Status">
          <option value="">Any status</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="closed">Closed</option>
        </select>
        <button className="btn">Search</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Member</th><th>Country</th><th>Joined</th><th>Status</th><th className="num">Credits</th><th className="num">Completed</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/admin/members/${r.id}`}>{r.display_name}</Link><div className="tiny muted">{r.email}</div></td>
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
