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
  // Bookcloth colours: deep, slightly muted bindings so the cream spine lettering stays readable.
  const spines = [
    { title: "Middlemarch", color: "#2a3f86", height: 196 },
    { title: "Dubliners", color: "#7b2d34", height: 168 },
    { title: "Frankenstein", color: "#2f5d4a", height: 210 },
    { title: "Little Women", color: "#5b3a6e", height: 182 },
    { title: "Dracula", color: "#1d2a4f", height: 200 },
    { title: "Persuasion", color: "#8a5a0b", height: 160 },
    { title: "Moby-Dick", color: "#24566b", height: 214 },
  ];

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
            <p className="eyebrow">A community book exchange</p>
            <h1>
              Give every book another <em>chapter.</em>
            </h1>
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
            <ul className="assure">
              <li>Free to join</li>
              <li>Tracked shipping</li>
              <li>Senders pay their own postage</li>
              <li>Credits have no cash value</li>
            </ul>
          </div>
          {/* An illustration of the exchange: a shelf, and the slip a sender gets when their book arrives. */}
          <div className="scene" aria-hidden="true">
            <div className="shelf">
              {spines.map((s, i) => (
                <div
                  key={s.title}
                  className={i === 1 ? "spine spine-gap" : "spine"}
                  style={{ backgroundColor: s.color, height: s.height }}
                >
                  {s.title}
                </div>
              ))}
            </div>
            <div className="plank" />
            <div className="slip">
              <span className="slip-label">Credit slip</span>
              <dl>
                <dt>Title</dt>
                <dd>Dubliners</dd>
                <dt>Route</dt>
                <dd>Leeds → Toronto</dd>
                <dt>Status</dt>
                <dd>Delivered</dd>
              </dl>
              <span className="stamp">+1 CREDIT</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section-lg">
        <div className="container">
          <div className="row-between" style={{ alignItems: "end", marginBottom: 28 }}>
            <div>
              <p className="kicker">How it works</p>
              <h2 className="mb-0">Pass one on, pick one up.</h2>
              <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
                Credits connect a whole network of readers, so you never need to find someone who wants your exact book.
              </p>
            </div>
            <Link href="/how-it-works">See the full walkthrough →</Link>
          </div>
          <div className="steps">
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
          <div className="loop-note">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
              <path d="M3 21v-5h5" />
            </svg>
            <span>Your credit requests your next read, and that book&apos;s sender earns one in turn.</span>
          </div>
        </div>
      </section>

      <section className="section-lg section-alt">
        <div className="container">
          <div className="row-between" style={{ alignItems: "end", marginBottom: 24 }}>
            <div>
              <p className="kicker">Catalogue</p>
              <h2 className="mb-0">Browse by category</h2>
            </div>
            <Link href="/explore">All books →</Link>
          </div>
          <div className="drawers">
            {categories.map((c) => (
              <Link key={c.slug} href={`/explore?category=${c.slug}`} className="drawer">
                <span className="holder">
                  <b>{c.name}</b>
                  <span>{c.n} available</span>
                </span>
                <span className="pull" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </div>
      </section>

      {recent.length >= 4 && (
        <section className="section-lg">
          <div className="container">
            <div className="row-between" style={{ alignItems: "end", marginBottom: 24 }}>
              <div>
                <p className="kicker">New on the shelf</p>
                <h2 className="mb-0">Recently listed</h2>
              </div>
              <Link href="/explore?sort=newest">See more →</Link>
            </div>
            <div className="grid-books">
              {recent.map((l) => (
                <BookCard key={l.id} l={l} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section-lg section-alt">
        <div className="container grid-2">
          <div className="card">
            <p className="kicker">Condition standard</p>
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
            <p className="kicker">Routes</p>
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

      <section className="section-lg">
        <div className="container narrow">
          <p className="kicker">Questions</p>
          <h2>Before you join</h2>
          <FaqList items={HOME_FAQ} />
          <p style={{ marginTop: 16 }}>
            <Link href="/help">More answers in the help center →</Link>
          </p>
        </div>
      </section>
    </>
  );
}
