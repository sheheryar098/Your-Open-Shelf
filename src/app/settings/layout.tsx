import Link from "next/link";
import { requireUser } from "@/shared/api/session";

const LINKS = [
  ["/settings/profile", "Profile"],
  ["/settings/addresses", "Addresses"],
  ["/settings/shipping", "Shipping preferences"],
  ["/settings/notifications", "Notifications"],
  ["/settings/account", "Account & privacy"],
  ["/membership", "Membership"],
];

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireUser("/settings/profile");
  return (
    <div className="container page">
      <h1>Settings</h1>
      <div className="admin-shell">
        <nav className="side-nav" aria-label="Settings">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="stack-lg">{children}</div>
      </div>
    </div>
  );
}
