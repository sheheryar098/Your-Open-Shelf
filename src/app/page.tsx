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

  return (
    <>
      {sp.closed && (
        <div className="container" style={{ paddingTop: 16 }}>
          <div className="alert alert-ok">Your account has been closed. Thank you for being part of YOS.</div>
        </div>
      )}

      <section className="home-hero">
        <div className="container home-hero-grid">
          <div className="home-hero-copy">
            <span className="home-eyebrow">
              <span className="home-eyebrow-dot" /> A community-powered book exchange
            </span>
            <h1>
              Good books deserve <em>another life.</em>
            </h1>
            <p className="home-hero-lede">
              Pass a story on. Discover your next favourite. Exchange books with readers around the world using simple
              YOS credits.
            </p>
            <div className="home-hero-actions">
              <Link href="/explore" className="btn btn-warm btn-lg">
                Explore the shelf ↗
              </Link>
              <Link href="/my/books/new" className="btn btn-lg">
                Share a book
              </Link>
            </div>
            <div className="home-proof">
              <span>
                <b>01</b> List a book you own
              </span>
              <span>
                <b>02</b> Send it to a reader
              </span>
              <span>
                <b>03</b> Earn a credit to read again
              </span>
            </div>
          </div>
          <div className="home-hero-art" aria-hidden="true">
            <div className="home-art-note">
              A little more
              <br />
              reading. A little
              <br />
              less waste.
            </div>
            <div className="home-art-sun" />
            <div className="home-book home-book-one">
              <span>
                THE ART
                <br />
                OF READING
              </span>
              <small>Stories to share</small>
            </div>
            <div className="home-book home-book-two">
              <span>
                WILD
                <br />
                PLACES
              </span>
              <small>Vol. 01</small>
            </div>
            <div className="home-book home-book-three">
              <span>
                THE
                <br />
                GARDEN
                <br />
                OF WORDS
              </span>
              <small>YOS EDITION</small>
            </div>
            <div className="home-art-spark">✳</div>
            <div className="home-art-caption">YOUR NEXT CHAPTER STARTS HERE</div>
          </div>
        </div>
      </section>

      <section className="home-benefits" aria-label="Why exchange with YOS">
        <div className="container home-benefit-grid">
          <div>
            <span className="home-benefit-icon">↗</span>
            <span>
              <strong>Give books a second life</strong>
              <small>Keep good stories in circulation</small>
            </span>
          </div>
          <div>
            <span className="home-benefit-icon">◎</span>
            <span>
              <strong>A global reading community</strong>
              <small>Connect through the books you love</small>
            </span>
          </div>
          <div>
            <span className="home-benefit-icon">✳</span>
            <span>
              <strong>Simple credit exchanges</strong>
              <small>One book shared, one credit earned</small>
            </span>
          </div>
        </div>
      </section>

      <section className="section home-section">
        <div className="container">
          <div className="home-section-heading">
            <div>
              <span className="home-kicker">FIND YOUR NEXT READ</span>
              <h2>Explore the shelf</h2>
              <p className="muted">A world of well-loved books, waiting for a new home.</p>
            </div>
            <Link href="/explore" className="home-text-link">
              Browse all books →
            </Link>
          </div>
          <div className="home-category-grid">
            {categories.slice(0, 6).map((c, i) => (
              <Link
                key={c.slug}
                href={`/explore?category=${c.slug}`}
                className={`home-category home-category-${i % 6}`}
              >
                <span className="home-category-number">{String(i + 1).padStart(2, "0")}</span>
                <span className="home-category-name">{c.name}</span>
                <span className="home-category-count">{c.n} books ↗</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="section home-recent-section">
          <div className="container">
            <div className="home-section-heading">
              <div>
                <span className="home-kicker">FRESH ON THE SHELF</span>
                <h2>Recently shared</h2>
                <p className="muted">The latest books added by our reading community.</p>
              </div>
              <Link href="/explore?sort=newest" className="home-text-link">
                See all listings →
              </Link>
            </div>
            <div className="grid-books home-book-grid">
              {recent.map((l) => (
                <BookCard key={l.id} l={l} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section home-how-section">
        <div className="container">
          <div className="home-section-heading">
            <div>
              <span className="home-kicker">READ. SHARE. REPEAT.</span>
              <h2>Good things get passed on.</h2>
              <p className="muted">No selling, no haggling. Just readers helping readers find their next story.</p>
            </div>
            <Link href="/how-it-works" className="home-text-link">
              How YOS works →
            </Link>
          </div>
          <div className="home-steps">
            <article>
              <span className="home-step-no">01 / SHARE</span>
              <div className="home-step-symbol">＋</div>
              <h3>List a book</h3>
              <p>Add a book from your shelf, describe its condition honestly and upload photos of your actual copy.</p>
            </article>
            <article>
              <span className="home-step-no">02 / CONNECT</span>
              <div className="home-step-symbol">↗</div>
              <h3>Send it on</h3>
              <p>When another reader requests it, pack it with care and ship it with tracking.</p>
            </article>
            <article>
              <span className="home-step-no">03 / DISCOVER</span>
              <div className="home-step-symbol">✳</div>
              <h3>Read something new</h3>
              <p>Earn a YOS credit when the exchange completes, then use it to request your next read.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="section home-details-section">
        <div className="container home-details-grid">
          <div className="home-detail-card">
            <span className="home-kicker">A BETTER WAY TO SHARE</span>
            <h2>Every copy has a story.</h2>
            <p>
              Listings use a clear condition standard and photos of the real book, so you know what is heading your way.
            </p>
            <ul className="home-condition-list">
              {Object.values(CONDITIONS).map((c) => (
                <li key={c.label}>
                  <strong>{c.label}</strong>
                  <span>{c.guidance}</span>
                </li>
              ))}
            </ul>
            <Link href="/condition-guide" className="home-text-link">
              Read our condition guide →
            </Link>
          </div>
          <div className="home-detail-card">
            <span className="home-kicker">READING HAS NO BORDERS</span>
            <h2>Where YOS works today.</h2>
            <p>
              Anyone can browse from anywhere. Exchanges are available on routes checked for carriers, tracking and
              customs.
            </p>
            <div className="home-country-label">CURRENTLY EXCHANGING</div>
            <p className="home-country-list">
              {open.map((c) => countryName(c.code)).join(" · ") || "New routes are being reviewed."}
            </p>
            {crossBorder.length > 0 && (
              <p className="small muted">
                <strong>Cross-border:</strong>{" "}
                {crossBorder
                  .map((r) => `${countryName(r.origin_country)} → ${countryName(r.destination_country)}`)
                  .join(" · ")}
              </p>
            )}
            <Link href="/shipping" className="home-text-link">
              Countries &amp; shipping →
            </Link>
          </div>
        </div>
      </section>

      <section className="home-cta">
        <div className="container home-cta-inner">
          <div>
            <span className="home-kicker">MAKE ROOM FOR A NEW STORY</span>
            <h2>Your shelf has more to give.</h2>
            <p>Share a book you love and help someone else discover it.</p>
          </div>
          <Link href="/my/books/new" className="btn btn-lg home-cta-button">
            List a book ↗
          </Link>
        </div>
      </section>

      <section className="section home-faq-section">
        <div className="container narrow">
          <span className="home-kicker">GOOD TO KNOW</span>
          <h2>Questions, answered.</h2>
          <FaqList items={HOME_FAQ} />
          <p style={{ marginTop: 16 }}>
            <Link href="/help">Visit the help center →</Link>
          </p>
        </div>
      </section>
    </>
  );
}
