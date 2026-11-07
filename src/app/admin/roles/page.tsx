import { requirePermission } from "@/shared/api/session";
import { permissionsFor, type Permission } from "@/server/rbac";
import { staffMembers } from "@/server/queries/admin";
import Link from "next/link";

export const metadata = { title: "Roles & permissions" };

const DESCRIBE: Record<Permission, string> = {
  "staff.access": "Access the admin area",
  "members.view": "View member accounts (only data needed for a case)",
  "members.restrict": "Restrict listing or requesting",
  "members.suspend": "Suspend or reinstate accounts",
  "members.roles": "Change staff roles",
  "listings.moderate": "Moderate listings and correct catalog metadata",
  "exchanges.view": "View exchanges and delivery addresses for case handling",
  "exchanges.intervene": "Cancel, mark delivered, extend deadlines, run jobs",
  "disputes.manage": "Review and decide disputes",
  "reports.manage": "Handle member reports",
  "support.manage": "Handle support tickets",
  "credits.view": "View the credit ledger and reconciliation",
  "credits.adjust": "Adjust and reverse credits",
  "routes.manage": "Manage countries and shipping routes",
  "content.manage": "Manage announcements",
  "analytics.view": "View analytics",
  "audit.view": "View the audit log",
};

export default async function Roles() {
  await requirePermission("members.roles");
  const mod = new Set(permissionsFor("moderator"));
  const admin = new Set(permissionsFor("admin"));
  const staff = await staffMembers();
  return (
    <>
      <h1>Roles &amp; permissions</h1>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Permission</th>
              <th>Moderator</th>
              <th>Admin</th>
            </tr>
          </thead>
          <tbody>
            {(Object.keys(DESCRIBE) as Permission[]).map((p) => (
              <tr key={p}>
                <td>
                  <span className="mono small">{p}</span>
                  <div className="small muted">{DESCRIBE[p]}</div>
                </td>
                <td>{mod.has(p) ? "✓" : ""}</td>
                <td>{admin.has(p) ? "✓" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="card">
        <h2>Staff</h2>
        {staff.map((s) => (
          <div key={s.id} className="list-item">
            <div className="body">
              <Link href={`/admin/members/${s.id}`}>{s.display_name}</Link>{" "}
              <span className="small muted">{s.email}</span>
            </div>
            <span className="badge badge-info">{s.role}</span>
          </div>
        ))}
        <p className="small muted">
          Change a member&apos;s role from their member page. Role changes are audit-logged.
        </p>
      </section>
    </>
  );
}
