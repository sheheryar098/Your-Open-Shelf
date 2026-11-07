import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { queryOne } from "@/lib/db";
import { countryName } from "@/lib/countries";
import { getCountry } from "@/domain/routes";
import { devOutboxEnabled } from "@/lib/config";

export const metadata = { title: "Welcome" };

/** Onboarding checklist (§6.2). */
export default async function Welcome() {
  const u = await requireUser("/welcome");
  const [country, counts] = await Promise.all([
    u.country_code ? getCountry(u.country_code) : null,
    queryOne<{ addresses: number; listings: number }>(
      `SELECT (SELECT count(*)::int FROM addresses WHERE user_id = $1 AND deleted_at IS NULL) AS addresses,
              (SELECT count(*)::int FROM listings WHERE owner_id = $1) AS listings`,
      [u.id],
    ),
  ]);
  const items = [
    { done: !!u.country_code, label: `Choose your country${u.country_code ? ` — ${countryName(u.country_code)}` : ""}`, href: "/settings/profile" },
    { done: !!u.email_verified_at, label: "Verify your email address", href: "/verify-email" },
    { done: !!u.avatar_file_id, label: "Add a profile photo (optional)", href: "/settings/profile" },
    { done: false, label: "Read the book condition standard", href: "/condition-guide" },
    { done: u.ship_scope === "international", label: "Set where you're happy to ship", href: "/settings/shipping" },
    { done: (counts?.addresses ?? 0) > 0, label: "Add a delivery address (when you're ready to request)", href: "/settings/addresses" },
    { done: false, label: "Learn how credits work", href: "/credits" },
    { done: (counts?.listings ?? 0) > 0, label: "List your first book — or browse the catalog", href: "/my/books/new" },
  ];
  return (
    <div className="container narrow page">
      <h1>Welcome to YOS, {u.display_name}!</h1>
      <p className="lede">Here&apos;s how to get set up. Your first credit comes from sending a book to another member.</p>
      {country && (country.status === "waitlist" || country.status === "unavailable") && (
        <div className="callout callout-warm" style={{ marginBottom: 20 }}>
          <p>
            Exchanges aren&apos;t open in {countryName(country.code)} yet. You can browse and draft listings, and we&apos;ll email you when
            your country opens. <Link href="/shipping">See where YOS works →</Link>
          </p>
        </div>
      )}
      <div className="card">
        {items.map((i) => (
          <div key={i.label} className="list-item">
            <span className={`badge ${i.done ? "badge-ok" : ""}`} aria-label={i.done ? "Done" : "To do"}>{i.done ? "✓" : "○"}</span>
            <div className="body"><Link href={i.href}>{i.label}</Link></div>
          </div>
        ))}
      </div>
      {!u.email_verified_at && devOutboxEnabled() && (
        <p className="small muted" style={{ marginTop: 16 }}>Development mode: find your verification email in the <Link href="/dev/outbox">outbox</Link>.</p>
      )}
      <div className="row" style={{ marginTop: 24 }}>
        <Link href="/my/books/new" className="btn btn-primary">List a book</Link>
        <Link href="/explore" className="btn">Explore books</Link>
        <Link href="/dashboard" className="btn btn-ghost">Go to dashboard</Link>
      </div>
    </div>
  );
}
