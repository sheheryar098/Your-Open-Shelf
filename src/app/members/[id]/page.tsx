import { notFound } from "next/navigation";
import { publicProfile } from "@/domain/support";
import { senderPerformance } from "@/domain/exchanges";
import { query } from "@/lib/db";
import { countryName } from "@/lib/countries";
import { fmtDate, plural } from "@/lib/format";
import { REVIEW_TAGS } from "@/lib/vocab";
import { currentUser } from "@/lib/auth/session";
import { BookCard, Empty, Stars, Photo } from "@/components/ui";
import { ReportForm } from "@/components/ReportForm";
import type { ListingCard } from "@/domain/listings";

export const metadata = { title: "Member profile" };

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const p = await publicProfile(id);
  if (!p || p.user.status !== "active") notFound();
  const [perf, listings, viewer] = await Promise.all([
    senderPerformance(id),
    query<ListingCard>(
      `SELECT l.id, b.title, b.authors, l.format, l.condition, l.language, l.origin_country, l.status, l.published_at, '' AS owner_name,
         (SELECT file_id FROM listing_photos WHERE listing_id = l.id ORDER BY position LIMIT 1) AS photo_id
       FROM listings l JOIN books b ON b.id = l.book_id WHERE l.owner_id = $1 AND l.status IN ('active', 'reserved') ORDER BY l.published_at DESC LIMIT 24`,
      [id],
    ),
    currentUser(),
  ]);
  return (
    <div className="container page">
      <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
        {p.user.avatar_file_id && (
          <div style={{ width: 88, height: 88, borderRadius: "50%", overflow: "hidden", flex: "none" }}>
            <Photo fileId={p.user.avatar_file_id} alt="" />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="mb-0">{p.user.display_name}</h1>
          <p className="muted">
            {p.user.country_code && countryName(p.user.country_code)} · Member since {fmtDate(p.user.created_at)}
          </p>
          {p.user.bio && <p>{p.user.bio}</p>}
        </div>
      </div>
      <div className="stats" style={{ marginTop: 16 }}>
        <div className="stat"><div className="v">{p.completed}</div><div className="k">Completed exchanges</div></div>
        <div className="stat"><div className="v">{p.avgRating ? p.avgRating.toFixed(1) : "—"}</div><div className="k">{plural(p.reviewCount, "rating")}</div></div>
        {perf.avgDispatchHours !== null && perf.totalAccepted >= 3 && (
          <div className="stat"><div className="v">{Math.max(1, Math.round(perf.avgDispatchHours / 24))}d</div><div className="k">Typical time to dispatch</div></div>
        )}
      </div>

      <h2 style={{ marginTop: 32 }}>On their shelf</h2>
      {listings.length ? <div className="grid-books">{listings.map((l) => <BookCard key={l.id} l={l} />)}</div> : <Empty>No books listed right now.</Empty>}

      <h2 style={{ marginTop: 32 }}>Feedback</h2>
      {p.reviews.length === 0 ? (
        <Empty>No feedback yet.</Empty>
      ) : (
        <div className="card">
          {p.reviews.map((r) => (
            <div key={r.id} className="list-item">
              <div className="body">
                <div className="row-between">
                  <span><Stars value={r.rating} /> <span className="small muted">from {r.reviewer_name} · {fmtDate(r.created_at)}</span></span>
                  {viewer && viewer.id !== id && <ReportForm targetType="review" targetId={r.id} label="Report" />}
                </div>
                {r.tags.length > 0 && <div className="row small" style={{ marginTop: 4 }}>{r.tags.map((t) => <span key={t} className="badge">{REVIEW_TAGS[t] ?? t}</span>)}</div>}
                {r.comment && <p className="mb-0" style={{ marginTop: 6 }}>{r.comment}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
      {viewer && viewer.id !== id && <div style={{ marginTop: 20 }}><ReportForm targetType="member" targetId={id} label="Report this member" /></div>}
    </div>
  );
}
