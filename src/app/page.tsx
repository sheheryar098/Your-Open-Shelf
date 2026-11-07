import Link from "next/link";
import { recentListings } from "@/server/domain/listings";
import { enabledRoutes, listCountries } from "@/server/domain/routes";
import { categoryCounts } from "@/server/queries/site";
import { countryName } from "@/shared/lib/countries";
import { CONDITIONS } from "@/shared/lib/vocab";
import { BookCard } from "@/features/listings/components/BookCard";
import { HOME_FAQ } from "@/features/content/model/faq";
import { FaqList } from "@/features/content/components/FaqList";

export default async function Home({ searchParams }: { searchParams: Promise<{ closed?: string }> }) {
  const sp = await searchParams;
  const [recent, countries, routes, categories] = await Promise.all([
    recentListings(8),
    listCountries(),
    enabledRoutes(),
    categoryCounts(),
  ]);
  const open = countries.filter((c) => c.status === "open" || c.status === "limited");
  const crossBorder = routes.filter((r) => r.origin_country !== r.destination_country);
  const spines = ["#1f6b5c", "#b5652a", "#2457a6", "#7a3e6b", "#3d5a2a", "#a23b2e", "#455069"];

  return (
    <>
      {sp.closed && (
        <div className="container" style={{ paddingTop: 16 }}>
          <div className="alert alert-ok">Your account has been closed. Thank you for being part of YOS.</div>
        </div>
      )}
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="badge badge-warm">A community book exchange</p>
            <h1>Give Every Book Another Chapter.</h1>
            <p className="lede">
              List a book you&apos;re ready to pass on. Send it to another reader. Earn a YOS credit and use it to
              request your next read from anyone on the shelf.
            </p>
            <div className="actions">
              <Link href="/explore" className="btn btn-primary btn-lg">
                Explore books
              </Link>
              <Link href="/my/books/new" className="btn btn-lg">
                List your first book
              </Link>
            </div>
            <p className="small muted" style={{ marginTop: 16 }}>
              Free to join. Senders pay their own postage; credits have no cash value.
            </p>
          </div>
          <div aria-hidden="true">
            <div className="shelf">
              {["Middlemarch", "Dubliners", "Frankenstein", "Little Women", "Dracula", "Persuasion", "Moby-Dick"].map(
                (t, i) => (
                  <div key={t} className="spine" style={{ background: spines[i], height: 150 + ((i * 37) % 70) }}>
                    {t}
                  </div>
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>How it works</h2>
          <p className="muted">
            Credits connect a whole network of readers, so you never need to find someone who wants your exact book.
          </p>
          <div className="steps" style={{ marginTop: 20 }}>
            <div className="step">
              <h3>List a book</h3>
              <p>Add a physical book you own, with honest condition notes and photos of your copy.</p>
            </div>
            <div className="step">
              <h3>Send it on</h3>
              <p>When a member requests it, accept, pack it carefully and ship it with tracking.</p>
            </div>
            <div className="step">
              <h3>Earn a credit</h3>
              <p>Once the exchange completes, a credit lands in your wallet. Spend it on any eligible book.</p>
            </div>
          </div>
          <p style={{ marginTop: 16 }}>
            <Link href="/how-it-works">See the full walkthrough →</Link>
          </p>
        </div>
      </section>

      <section className="section" style={{ background: "var(--paper-2)" }}>
        <div className="container">
          <div className="row-between">
            <h2 className="mb-0">Browse by category</h2>
            <Link href="/explore">All books →</Link>
          </div>
          <div className="grid-3" style={{ marginTop: 16 }}>
            {categories.map((c) => (
              <Link key={c.slug} href={`/explore?category=${c.slug}`} className="stat">
                <div style={{ fontFamily: "var(--serif)", fontWeight: 600 }}>{c.name}</div>
                <div className="k">{c.n} available</div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {recent.length >= 4 && (
        <section className="section">
          <div className="container">
            <div className="row-between">
              <h2 className="mb-0">Recently listed</h2>
              <Link href="/explore?sort=newest">See more →</Link>
            </div>
            <div className="grid-books" style={{ marginTop: 16 }}>
              {recent.map((l) => (
                <BookCard key={l.id} l={l} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="container grid-2">
          <div className="card">
            <h2>Honest condition, real photos</h2>
            <p>Every listing uses the same condition standard and shows photos of the actual copy, not stock images.</p>
            <ul className="small">
              {Object.values(CONDITIONS).map((c) => (
                <li key={c.label}>
                  <strong>{c.label}:</strong> {c.guidance}
                </li>
              ))}
            </ul>
            <Link href="/condition-guide">Read the condition guide →</Link>
          </div>
          <div className="card">
            <h2>Where YOS works today</h2>
            <p>
              Anyone can browse from anywhere. Exchanges run on routes we&apos;ve checked for carriers, tracking and
              customs, and we add more as delivery data proves them reliable.
            </p>
            <p className="small">
              <strong>Exchanging now:</strong> {open.map((c) => countryName(c.code)).join(", ")}.
            </p>
            {crossBorder.length > 0 && (
              <p className="small">
                <strong>Cross-border routes:</strong>{" "}
                {crossBorder
                  .map((r) => `${countryName(r.origin_country)} → ${countryName(r.destination_country)}`)
                  .join(" · ")}
              </p>
            )}
            <Link href="/shipping">Countries &amp; shipping →</Link>
          </div>
        </div>
      </section>

      <section className="section" style={{ background: "var(--paper-2)" }}>
        <div className="container narrow">
          <h2>Questions</h2>
          <FaqList items={HOME_FAQ} />
          <p style={{ marginTop: 16 }}>
            <Link href="/help">More answers in the help center →</Link>
          </p>
        </div>
      </section>
    </>
  );
}
