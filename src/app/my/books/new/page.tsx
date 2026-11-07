import Link from "next/link";
import { requireUser } from "@/shared/api/session";
import { getBook, lookupIsbn, searchCatalog, type BookInput } from "@/server/domain/catalog";
import { getCountry } from "@/server/domain/routes";
import { looksLikeIsbn } from "@/shared/lib/isbn";
import { authorsText } from "@/shared/lib/format";
import { countryName } from "@/shared/lib/countries";
import { policy } from "@/server/config";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { CopyFields } from "@/features/listings/components/CopyFields";
import { createListingAction } from "@/features/listings/api/actions";
import { isUuid } from "@/shared/lib/ids";

export const metadata = { title: "List a book" };

export default async function NewListing({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; bookId?: string; manual?: string }>;
}) {
  const u = await requireUser("/my/books/new");
  const sp = await searchParams;
  const country = u.country_code ? await getCountry(u.country_code) : null;
  const chosen = sp.bookId && isUuid(sp.bookId) ? await getBook(sp.bookId) : null;
  const results = sp.q && !chosen ? await searchCatalog(sp.q) : [];
  const lookup: BookInput | null =
    sp.q && !chosen && results.length === 0 && looksLikeIsbn(sp.q) ? await lookupIsbn(sp.q) : null;
  const showForm = !!chosen || sp.manual === "1" || !!lookup;

  return (
    <div className="container narrow page stack-lg">
      <div>
        <h1>List a book</h1>
        <p className="muted">Find the book in the catalog by ISBN, title or author, then describe your copy.</p>
      </div>
      {!u.can_list && (
        <div className="alert alert-warn">
          Listing is currently restricted on your account. <Link href="/support/new">Contact support</Link>
        </div>
      )}
      {country && !["open", "limited"].includes(country.status) && (
        <div className="alert alert-info">
          Exchanges aren&apos;t open in {countryName(country.code)} yet. You can save drafts now and publish them when
          your country opens.
        </div>
      )}

      {!chosen && (
        <section className="card">
          <h2>1. Find the book</h2>
          <form className="row" role="search">
            <label htmlFor="q" className="sr-only">
              ISBN, title or author
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={sp.q}
              placeholder="ISBN, title or author"
              style={{ flex: 1, minWidth: 200 }}
              required
            />
            <button className="btn btn-primary">Search catalog</button>
          </form>
          {sp.q && (
            <div style={{ marginTop: 16 }}>
              {results.length > 0 ? (
                <>
                  <p className="small muted">Choose the matching edition:</p>
                  {results.map((b) => (
                    <div key={b.id} className="list-item">
                      <div className="body">
                        <div className="title">{b.title}</div>
                        <div className="small muted">
                          {authorsText(b.authors)}
                          {b.publisher ? ` · ${b.publisher}` : ""}
                          {b.publication_year ? ` · ${b.publication_year}` : ""}
                          {b.isbn13 ? ` · ISBN ${b.isbn13}` : ""}
                          {b.edition ? ` · ${b.edition}` : ""}
                        </div>
                      </div>
                      <Link className="btn btn-sm" href={`/my/books/new?bookId=${b.id}`}>
                        Use this
                      </Link>
                    </div>
                  ))}
                  <p className="small" style={{ marginTop: 12 }}>
                    Not the right edition?{" "}
                    <Link href={`/my/books/new?manual=1&q=${encodeURIComponent(sp.q)}`}>
                      Enter the details yourself
                    </Link>
                  </p>
                </>
              ) : lookup ? (
                <p className="small">We found catalog details for this ISBN. Check them below.</p>
              ) : (
                <p className="small">
                  No catalog match.{" "}
                  <Link href={`/my/books/new?manual=1&q=${encodeURIComponent(sp.q)}`}>
                    Enter the book&apos;s details manually
                  </Link>
                  .
                </p>
              )}
            </div>
          )}
          {!sp.q && (
            <p className="small" style={{ marginTop: 12 }}>
              Or <Link href="/my/books/new?manual=1">enter the details manually</Link>.
            </p>
          )}
        </section>
      )}

      {showForm && (
        <section className="card">
          <h2>{chosen ? "Describe your copy" : "2. Book details & your copy"}</h2>
          {chosen && (
            <div className="callout" style={{ marginBottom: 16 }}>
              <p>
                <strong>{chosen.title}</strong>: {authorsText(chosen.authors)}
                {chosen.isbn13 ? ` · ISBN ${chosen.isbn13}` : ""}
              </p>
              <p className="small">
                <Link href="/my/books/new">Choose a different book</Link>
              </p>
            </div>
          )}
          <ActionForm action={createListingAction} encType="multipart/form-data">
            {chosen ? (
              <input type="hidden" name="bookId" value={chosen.id} />
            ) : (
              <>
                <div className="field">
                  <label htmlFor="title">Title</label>
                  <input
                    id="title"
                    name="title"
                    type="text"
                    required
                    maxLength={300}
                    defaultValue={lookup?.title ?? (sp.q && !looksLikeIsbn(sp.q) ? sp.q : "")}
                  />
                </div>
                <div className="field">
                  <label htmlFor="authors">Author(s) / editor(s)</label>
                  <input
                    id="authors"
                    name="authors"
                    type="text"
                    required
                    defaultValue={lookup?.authors.join(", ") ?? ""}
                  />
                  <span className="help">Separate multiple names with commas.</span>
                </div>
                <div className="field-row">
                  <div className="field">
                    <label htmlFor="isbn">ISBN (if it has one)</label>
                    <input
                      id="isbn"
                      name="isbn"
                      type="text"
                      inputMode="numeric"
                      defaultValue={lookup?.isbn ?? (sp.q && looksLikeIsbn(sp.q) ? sp.q : "")}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="publisher">Publisher</label>
                    <input id="publisher" name="publisher" type="text" defaultValue={lookup?.publisher ?? ""} />
                  </div>
                  <div className="field">
                    <label htmlFor="year">Publication year</label>
                    <input
                      id="year"
                      name="year"
                      type="number"
                      min={1400}
                      max={2100}
                      defaultValue={lookup?.publicationYear ?? ""}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="edition">Edition</label>
                  <input id="edition" name="edition" type="text" placeholder="e.g. 2nd edition" />
                </div>
                <hr />
              </>
            )}
            <CopyFields d={{ ship_scope: u.ship_scope, ship_countries: u.ship_countries }} origin={u.country_code} />
            <div className="field">
              <label htmlFor="photos">Photos of your actual copy</label>
              <input id="photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple />
              <span className="help">
                At least one photo is required to publish (up to {policy.maxPhotosPerListing}, 5 MB each). Show the
                front, back, spine and any damage. Don&apos;t use stock images.
              </span>
            </div>
            <SubmitButton pendingText="Saving…">Save and review</SubmitButton>
            <p className="tiny muted">
              Your listing is saved as a draft. You&apos;ll review and publish it on the next step.
            </p>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
