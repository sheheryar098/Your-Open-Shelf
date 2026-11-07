import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { query } from "@/lib/db";
import { countryName } from "@/lib/countries";
import { CONDITIONS, FORMATS, LISTING_STATUS_LABEL, label } from "@/lib/vocab";
import { authorsText, fmtDate } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ListingBadge, BookMedia } from "@/components/ui";
import { editBookAction, moderateListingAction } from "@/app/actions/admin";

export const metadata = { title: "Listings & catalog" };

export default async function AdminListings({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; flagged?: string }> }) {
  await requirePermission("listings.moderate");
  const sp = await searchParams;
  const params: unknown[] = [];
  const where = ["true"];
  if (sp.q) {
    params.push(`%${sp.q.toLowerCase()}%`);
    where.push(`(lower(b.title) LIKE $${params.length} OR lower(u.display_name) LIKE $${params.length} OR b.isbn13 LIKE $${params.length} OR l.id::text LIKE $${params.length})`);
  }
  if (sp.status) {
    params.push(sp.status);
    where.push(`l.status = $${params.length}`);
  }
  if (sp.flagged) {
    where.push(`(EXISTS (SELECT 1 FROM reports r WHERE r.target_id = l.id AND r.status = 'open')
      OR EXISTS (SELECT 1 FROM listings d WHERE d.owner_id = l.owner_id AND d.book_id = l.book_id AND d.id <> l.id AND d.status IN ('active','reserved','paused')))`);
  }
  const rows = await query<{
    id: string; book_id: string; title: string; authors: string[]; isbn13: string | null; publisher: string | null; publication_year: number | null; edition: string | null;
    format: string; condition: string; status: string; origin_country: string; owner_id: string; owner_name: string; created_at: Date; condition_notes: string;
    photo_id: string | null; photo_count: number; open_reports: number; duplicates: number;
  }>(
    `SELECT l.id, l.book_id, b.title, b.authors, b.isbn13, b.publisher, b.publication_year, b.edition, l.format, l.condition, l.status, l.origin_country,
       l.owner_id, u.display_name AS owner_name, l.created_at, l.condition_notes,
       (SELECT file_id FROM listing_photos p WHERE p.listing_id = l.id ORDER BY position LIMIT 1) AS photo_id,
       (SELECT count(*)::int FROM listing_photos p WHERE p.listing_id = l.id) AS photo_count,
       (SELECT count(*)::int FROM reports r WHERE r.target_id = l.id AND r.status = 'open') AS open_reports,
       (SELECT count(*)::int FROM listings d WHERE d.owner_id = l.owner_id AND d.book_id = l.book_id AND d.id <> l.id AND d.status IN ('active','reserved','paused')) AS duplicates
     FROM listings l JOIN books b ON b.id = l.book_id JOIN users u ON u.id = l.owner_id
     WHERE ${where.join(" AND ")} ORDER BY open_reports DESC, l.updated_at DESC LIMIT 60`,
    params,
  );
  return (
    <>
      <h1>Listings &amp; catalog</h1>
      <form className="row">
        <input name="q" type="search" defaultValue={sp.q} placeholder="Title, ISBN, member or listing ID" aria-label="Search listings" style={{ flex: 1, minWidth: 200 }} />
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(LISTING_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="check small"><input type="checkbox" name="flagged" defaultChecked={!!sp.flagged} /> Reported or duplicate</label>
        <button className="btn">Filter</button>
      </form>
      <div className="stack">
        {rows.map((l) => (
          <div key={l.id} className="card card-flat">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <div className="thumb" style={{ width: 70 }}><BookMedia title={l.title} authors={l.authors} photoId={l.photo_id} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row-between">
                  <div><Link href={`/books/${l.id}`} className="title" style={{ fontFamily: "var(--serif)", fontWeight: 600 }}>{l.title}</Link> <span className="small muted">{authorsText(l.authors)}</span></div>
                  <div className="row">
                    {l.open_reports > 0 && <span className="badge badge-danger">{l.open_reports} report(s)</span>}
                    {l.duplicates > 0 && <span className="badge badge-warn">possible duplicate</span>}
                    {l.photo_count === 0 && <span className="badge badge-warn">no photos</span>}
                    <ListingBadge status={l.status} />
                  </div>
                </div>
                <div className="small muted">
                  {label(FORMATS, l.format)} · {label(CONDITIONS, l.condition)} · {countryName(l.origin_country)} · by <Link href={`/admin/members/${l.owner_id}`}>{l.owner_name}</Link> · {fmtDate(l.created_at)}
                  {l.isbn13 && <> · ISBN {l.isbn13}</>}
                </div>
                <p className="small" style={{ margin: "6px 0" }}>{l.condition_notes}</p>
                <div className="grid-2">
                  <ActionForm action={moderateListingAction.bind(null, l.id)} className="row">
                    <select name="status" required defaultValue="" aria-label="Moderation action">
                      <option value="" disabled>Action…</option>
                      <option value="under_review">Mark under review</option>
                      <option value="removed">Remove listing</option>
                      <option value="paused">Pause listing</option>
                      <option value="active">Restore to active</option>
                    </select>
                    <input name="reason" type="text" required minLength={5} placeholder="Reason (shown to member)" aria-label="Reason" style={{ flex: 1, minWidth: 140 }} />
                    <SubmitButton className="btn btn-sm">Apply</SubmitButton>
                  </ActionForm>
                  <details className="small">
                    <summary>Correct catalog record</summary>
                    <ActionForm action={editBookAction.bind(null, l.book_id)}>
                      <div className="field-row">
                        <input name="title" defaultValue={l.title} required aria-label="Title" />
                        <input name="authors" defaultValue={l.authors.join(", ")} required aria-label="Authors" />
                        <input name="isbn" defaultValue={l.isbn13 ?? ""} placeholder="ISBN" aria-label="ISBN" />
                        <input name="publisher" defaultValue={l.publisher ?? ""} placeholder="Publisher" aria-label="Publisher" />
                        <input name="year" defaultValue={l.publication_year ?? ""} placeholder="Year" aria-label="Year" />
                        <input name="edition" defaultValue={l.edition ?? ""} placeholder="Edition" aria-label="Edition" />
                      </div>
                      <input name="reason" required minLength={5} placeholder="Reason" aria-label="Reason" />
                      <SubmitButton className="btn btn-sm">Save catalog record</SubmitButton>
                      <p className="tiny muted">Affects every listing that uses this catalog record.</p>
                    </ActionForm>
                  </details>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
