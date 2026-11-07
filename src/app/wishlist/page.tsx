import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { query } from "@/lib/db";
import { searchCatalog } from "@/domain/catalog";
import { authorsText, fmtDate } from "@/lib/format";
import { FORMATS, LANGUAGES, label } from "@/lib/vocab";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Empty } from "@/components/ui";
import { addToWishlistAction, removeFromWishlistAction } from "@/app/actions/listings";

export const metadata = { title: "Wish list" };

export default async function Wishlist({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const u = await requireUser("/wishlist");
  const { q } = await searchParams;
  const [items, results] = await Promise.all([
    query<{ id: string; book_id: string; title: string; authors: string[]; format: string | null; language: string | null; created_at: Date; available: number }>(
      `SELECT w.id, w.book_id, b.title, b.authors, w.format, w.language, w.created_at,
         (SELECT count(*)::int FROM listings l WHERE l.book_id = w.book_id AND l.status = 'active' AND l.owner_id <> $1) AS available
       FROM wishlist_items w JOIN books b ON b.id = w.book_id WHERE w.user_id = $1 ORDER BY w.created_at DESC`,
      [u.id],
    ),
    q ? searchCatalog(q, 10) : Promise.resolve([]),
  ]);
  const wished = new Set(items.map((i) => i.book_id));
  return (
    <div className="container narrow page stack-lg">
      <div>
        <h1>Wish list</h1>
        <p className="muted">Save books you want. We&apos;ll notify you when a copy is listed that can ship to you.</p>
      </div>
      <section className="card">
        <h2>Add a book</h2>
        <form className="row" role="search">
          <label htmlFor="q" className="sr-only">Search the catalog</label>
          <input id="q" name="q" type="search" defaultValue={q} placeholder="Title, author or ISBN" style={{ flex: 1, minWidth: 200 }} />
          <button className="btn">Search</button>
        </form>
        {q && (
          <div style={{ marginTop: 12 }}>
            {results.length === 0 && <p className="small muted">That book isn&apos;t in the catalog yet. Catalog records are created when members list books.</p>}
            {results.map((b) => (
              <div key={b.id} className="list-item">
                <div className="body"><div className="title">{b.title}</div><div className="small muted">{authorsText(b.authors)}{b.isbn13 ? ` · ${b.isbn13}` : ""}</div></div>
                {wished.has(b.id) ? <span className="badge badge-ok">On your list</span> : (
                  <ActionForm action={addToWishlistAction.bind(null, b.id)} className="row">
                    <select name="format" aria-label="Format" defaultValue=""><option value="">Any format</option>{Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <SubmitButton className="btn btn-sm">Add</SubmitButton>
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      {items.length === 0 ? <Empty>Your wish list is empty.</Empty> : (
        <div className="card">
          {items.map((i) => (
            <div key={i.id} className="list-item">
              <div className="body">
                <div className="title">{i.title}</div>
                <div className="small muted">
                  {authorsText(i.authors)} · {i.format ? label(FORMATS, i.format) : "any format"}{i.language ? ` · ${LANGUAGES[i.language]}` : ""} · added {fmtDate(i.created_at)}
                </div>
                {i.available > 0 && <Link href={`/explore?q=${encodeURIComponent(i.title)}`} className="small">{i.available} available now →</Link>}
              </div>
              <ActionForm action={removeFromWishlistAction.bind(null, i.id)} className="inline-form">
                <SubmitButton className="btn btn-ghost btn-sm">Remove</SubmitButton>
              </ActionForm>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
