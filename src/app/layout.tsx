import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/auth/session";
import { chosenCountry, suggestedCountry } from "@/lib/geo";
import { countryName } from "@/lib/countries";
import { can } from "@/lib/rbac";
import { query, queryOne } from "@/lib/db";
import { unreadCount } from "@/domain/notifications";
import { setCountryAction, signOutAction } from "./actions/auth";
import { CountrySelect } from "@/components/ui";
import { Flash } from "@/components/Flash";
import { cookies } from "next/headers";

export const metadata: Metadata = {
  title: { default: "YOS — Your Open Shelf", template: "%s · YOS" },
  description: "A community book exchange. List a book, send it to another reader, earn a credit, and use it to request your next read.",
  applicationName: "YOS — Your Open Shelf",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f1" },
    { media: "(prefers-color-scheme: dark)", color: "#14171d" },
  ],
};

async function CountryBanner({ signedIn }: { signedIn: boolean }) {
  if (signedIn) return null;
  const chosen = await chosenCountry();
  if (chosen) return null;
  const suggested = await suggestedCountry();
  return (
    <div className="banner banner-country" role="region" aria-label="Country selection">
      <div className="container">
        {suggested ? (
          <span>
            We think you&apos;re visiting from <strong>{countryName(suggested)}</strong>. Is this correct?
          </span>
        ) : (
          <span>Choose your country so we can show books that can be shipped to you.</span>
        )}
        <form action={setCountryAction}>
          {suggested && (
            <button className="btn btn-sm btn-primary" name="country" value={suggested}>
              Yes, that&apos;s right
            </button>
          )}
          <label className="sr-only" htmlFor="banner-country">Country</label>
          <CountrySelect id="banner-country" defaultValue={suggested} required={false} />
          <button className="btn btn-sm" type="submit">
            {suggested ? "Use selected" : "Save"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const [unread, wallet, announcements] = await Promise.all([
    user ? unreadCount(user.id) : 0,
    user ? queryOne<{ available: number }>("SELECT available FROM credit_accounts WHERE user_id = $1", [user.id]) : null,
    query<{ id: string; message: string; level: string }>("SELECT id, message, level FROM announcements WHERE active ORDER BY created_at DESC LIMIT 2"),
  ]);
  const staff = user && can(user.role, "staff.access");
  const flash = (await cookies()).get("yos_flash")?.value;

  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand" aria-label="YOS — Your Open Shelf, home">
              <b>YOS</b>
              <span>Your Open Shelf</span>
            </Link>
            <nav className="nav" aria-label="Main">
              <Link href="/explore">Explore books</Link>
              <Link href="/how-it-works">How it works</Link>
              {user && <Link href="/dashboard">Dashboard</Link>}
              {user && <Link href="/my/books">My books</Link>}
              {staff && <Link href="/admin">Admin</Link>}
            </nav>
            <div className="nav-right">
              {user ? (
                <>
                  <Link href="/wallet" className="credit-chip" title="Available credits">
                    {wallet?.available ?? 0} credit{wallet?.available === 1 ? "" : "s"}
                  </Link>
                  <Link href="/notifications" className="btn btn-ghost btn-sm" aria-label={`Notifications, ${unread} unread`}>
                    Notifications {unread > 0 && <span className="pill-count">{unread}</span>}
                  </Link>
                  <Link href="/my/books/new" className="btn btn-primary btn-sm">List a book</Link>
                  <form action={signOutAction} className="inline-form">
                    <button className="btn btn-ghost btn-sm">Sign out</button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/signin" className="btn btn-ghost btn-sm">Sign in</Link>
                  <Link href="/signup" className="btn btn-primary btn-sm">Join YOS</Link>
                </>
              )}
            </div>
          </div>
        </header>
        {announcements.map((a) => (
          <div key={a.id} className={`banner banner-${a.level}`}>
            <div className="container">{a.message}</div>
          </div>
        ))}
        {user && !user.email_verified_at && (
          <div className="banner banner-warning">
            <div className="container">
              Please verify your email address to list and request books. <Link href="/verify-email">Resend the link</Link>
            </div>
          </div>
        )}
        <CountryBanner signedIn={!!user} />
        <main id="main">{children}</main>
        {flash && <Flash key={flash} value={flash} />}
        <footer className="site-footer">
          <div className="container">
            <div className="cols">
              <div>
                <h4>YOS</h4>
                <p className="small muted">Your Books. New Readers. Endless Stories.</p>
                <p className="tiny muted">YOS credits have no cash value and can only be used to request books on YOS.</p>
              </div>
              <div>
                <h4>Exchange</h4>
                <ul>
                  <li><Link href="/explore">Explore books</Link></li>
                  <li><Link href="/how-it-works">How YOS works</Link></li>
                  <li><Link href="/credits">Credit system</Link></li>
                  <li><Link href="/condition-guide">Book condition guide</Link></li>
                  <li><Link href="/shipping">Countries &amp; shipping</Link></li>
                </ul>
              </div>
              <div>
                <h4>Community</h4>
                <ul>
                  <li><Link href="/about">About YOS</Link></li>
                  <li><Link href="/trust-safety">Trust &amp; safety</Link></li>
                  <li><Link href="/membership">Membership</Link></li>
                  <li><Link href="/help">Help center &amp; FAQ</Link></li>
                  <li><Link href="/contact">Contact us</Link></li>
                </ul>
              </div>
              <div>
                <h4>Policies</h4>
                <ul>
                  <li><Link href="/legal/terms">Terms of Service</Link></li>
                  <li><Link href="/legal/privacy">Privacy Policy</Link></li>
                  <li><Link href="/legal/credits">Credit System Terms</Link></li>
                  <li><Link href="/legal/prohibited-items">Prohibited items</Link></li>
                  <li><Link href="/legal">All policies</Link></li>
                </ul>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
