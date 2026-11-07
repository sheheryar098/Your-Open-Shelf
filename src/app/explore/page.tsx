import Link from "next/link";
import { searchListings, type SearchFilters } from "@/server/domain/listings";
import { query } from "@/server/db";
import { currentUser } from "@/shared/api/session";
import { chosenCountry } from "@/shared/api/geo";
import { countryName } from "@/shared/lib/countries";
import { CONDITIONS, FORMATS, LANGUAGES } from "@/shared/lib/vocab";
import { BookCard } from "@/features/listings/components/BookCard";
import { CursorPager, Empty } from "@/shared/ui/primitives";

export const metadata = { title: "Explore books" };

type SP = Record<string, string | undefined>;

export default async function Explore({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const myCountry = user?.country_code ?? (await chosenCountry());
  // Default to books that can reach the viewer; "anywhere" shows the full catalog.
  const shipsTo = sp.ships === "anywhere" ? undefined : myCountry ?? undefined;
  const filters: SearchFilters = {
    q: sp.q,
    format: sp.format || undefined,
    language: sp.language || undefined,
    condition: sp.condition || undefined,
    category: sp.category || undefined,
    senderCountry: sp.from || undefined,
    shipsTo,
    availability: sp.availability === "domestic" || sp.availability === "international" ? sp.availability : undefined,
    sort: sp.sort === "title" ? "title" : sp.sort === "relevance" ? "relevance" : "newest",
    cursor: sp.cursor ?? null,
  };
  const [results, categories, senderCountries] = await Promise.all([
    searchListings(filters),
    query<{ slug: string; name: string; parent_id: number | null }>("SELECT slug, name, parent_id FROM categories ORDER BY sort"),
    query<{ origin_country: string }>("SELECT DISTINCT origin_country FROM listings WHERE status IN ('active','reserved')"),
  ]);
  const qs = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/explore?${p.toString()}`;
  };

  return (
    <div className="container page">
      <div className="row-between">
        <h1 className="mb-0">Explore books</h1>
        {myCountry && (
          <div className="small">
            {shipsTo ? (
              <>Showing books that can ship to <strong>{countryName(myCountry)}</strong> · <Link href={qs({ ships: "anywhere", cursor: undefined })}>Show all</Link></>
            ) : (
              <>Showing books from everywhere · <Link href={qs({ ships: undefined, cursor: undefined })}>Only books that ship to {countryName(myCountry)}</Link></>
            )}
          </div>
        )}
      </div>

      <form className="card card-flat" style={{ marginTop: 16 }} role="search">
        <div className="field-row">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="q">Search by title, author, ISBN or keyword</label>
            <input id="q" name="q" type="search" defaultValue={sp.q} placeholder="e.g. Middlemarch, George Eliot, 9780141439549" />
          </div>
          <div className="field">
            <label htmlFor="category">Category</label>
            <select id="category" name="category" defaultValue={sp.category ?? ""}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.parent_id ? "— " : ""}{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="format">Format</label>
            <select id="format" name="format" defaultValue={sp.format ?? ""}>
              <option value="">Any format</option>
              {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="language">Language</label>
            <select id="language" name="language" defaultValue={sp.language ?? ""}>
              <option value="">Any language</option>
              {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="condition">Condition (at least)</label>
            <select id="condition" name="condition" defaultValue={sp.condition ?? ""}>
              <option value="">Any condition</option>
              {Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="from">Sender&apos;s country</label>
            <select id="from" name="from" defaultValue={sp.from ?? ""}>
              <option value="">Anywhere</option>
              {senderCountries.map((c) => <option key={c.origin_country} value={c.origin_country}>{countryName(c.origin_country)}</option>)}
            </select>
          </div>
          {shipsTo && (
            <div className="field">
              <label htmlFor="availability">Domestic / international</label>
              <select id="availability" name="availability" defaultValue={sp.availability ?? ""}>
                <option value="">Both</option>
                <option value="domestic">Domestic only</option>
                <option value="international">International only</option>
              </select>
            </div>
          )}
          <div className="field">
            <label htmlFor="sort">Sort</label>
            <select id="sort" name="sort" defaultValue={sp.sort ?? "newest"}>
              <option value="newest">Newest listings</option>
              <option value="relevance">Best match</option>
              <option value="title">Title A–Z</option>
            </select>
          </div>
        </div>
        {sp.ships && <input type="hidden" name="ships" value={sp.ships} />}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" type="submit">Search</button>
          <Link href="/explore" className="btn btn-ghost">Clear filters</Link>
        </div>
      </form>

      <p className="small muted" style={{ marginTop: 16 }}>
        {results.total} {results.total === 1 ? "book" : "books"} found. Every book costs one credit to request.
      </p>
      {results.rows.length === 0 ? (
        <Empty>
          <p>No books match those filters yet.</p>
          {user ? (
            <p>Search the catalog and add a book to your <Link href="/wishlist">wish list</Link> to be told when one is listed.</p>
          ) : (
            <p><Link href="/signup">Join YOS</Link> to add books to your wish list and be notified when they&apos;re listed.</p>
          )}
        </Empty>
      ) : (
        <div className="grid-books">
          {results.rows.map((l) => <BookCard key={l.id} l={l} />)}
        </div>
      )}
      <CursorPager nextHref={results.nextCursor ? qs({ cursor: results.nextCursor }) : null} firstHref={sp.cursor ? qs({ cursor: undefined }) : null} />
    </div>
  );
}
