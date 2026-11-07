import Link from "next/link";
import { requirePermission } from "@/shared/api/session";
import { can, type Permission } from "@/server/rbac";

export const metadata = { title: "Admin", robots: { index: false } };

const NAV: { group: string; items: [string, string, Permission][] }[] = [
  { group: "Operations", items: [["/admin", "Overview", "staff.access"], ["/admin/disputes", "Disputes", "disputes.manage"], ["/admin/reports", "Reports", "reports.manage"], ["/admin/support", "Support tickets", "support.manage"], ["/admin/jobs", "Jobs & queues", "exchanges.view"]] },
  { group: "Marketplace", items: [["/admin/members", "Members", "members.view"], ["/admin/listings", "Listings & catalog", "listings.moderate"], ["/admin/exchanges", "Requests & exchanges", "exchanges.view"], ["/admin/credits", "Credit ledger", "credits.view"]] },
  { group: "Configuration", items: [["/admin/countries", "Countries & routes", "routes.manage"], ["/admin/content", "Announcements", "content.manage"], ["/admin/roles", "Roles & permissions", "members.roles"]] },
  { group: "Insight", items: [["/admin/analytics", "Analytics", "analytics.view"], ["/admin/audit", "Audit log", "audit.view"]] },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePermission("staff.access");
  return (
    <div className="container page">
      <div className="admin-shell">
        <nav className="side-nav" aria-label="Admin">
          <div className="small muted" style={{ padding: "0 12px 8px" }}>Signed in as {u.display_name} ({u.role})</div>
          {NAV.map((g) => (
            <div key={g.group} style={{ display: "contents" }}>
              <div className="group">{g.group}</div>
              {g.items.filter(([, , p]) => can(u.role, p)).map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
            </div>
          ))}
        </nav>
        <div className="stack-lg" style={{ minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}
