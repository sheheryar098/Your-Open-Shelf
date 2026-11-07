import { notFound } from "next/navigation";
import { publicProfile } from "@/server/domain/support";
import { senderPerformance } from "@/server/domain/exchanges/queries";
import { shelfOf } from "@/server/queries/member";
import { countryName } from "@/shared/lib/countries";
import { fmtDate, plural } from "@/shared/lib/format";
import { REVIEW_TAGS } from "@/shared/lib/vocab";
import { currentUser } from "@/shared/api/session";
import { BookCard } from "@/features/listings/components/BookCard";
import { Empty, Stars } from "@/shared/ui/primitives";
import { Photo } from "@/shared/ui/book-media";
import { ReportForm } from "@/features/support/components/ReportForm";
import { isUuid } from "@/shared/lib/ids";

export const metadata = { title: "Member profile" };

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const p = await publicProfile(id);
  if (!p || p.user.status !== "active") notFound();
  const [perf, listings, viewer] = await Promise.all([senderPerformance(id), shelfOf(id), currentUser()]);
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
        <div className="stat">
          <div className="v">{p.completed}</div>
          <div className="k">Completed exchanges</div>
        </div>
        <div className="stat">
          <div className="v">{p.avgRating ? p.avgRating.toFixed(1) : "—"}</div>
          <div className="k">{plural(p.reviewCount, "rating")}</div>
        </div>
        {perf.avgDispatchHours !== null && perf.totalAccepted >= 3 && (
          <div className="stat">
            <div className="v">{Math.max(1, Math.round(perf.avgDispatchHours / 24))}d</div>
            <div className="k">Typical time to dispatch</div>
          </div>
        )}
      </div>

      <h2 style={{ marginTop: 32 }}>On their shelf</h2>
      {listings.length ? (
        <div className="grid-books">
          {listings.map((l) => (
            <BookCard key={l.id} l={l} />
          ))}
        </div>
      ) : (
        <Empty>No books listed right now.</Empty>
      )}

      <h2 style={{ marginTop: 32 }}>Feedback</h2>
      {p.reviews.length === 0 ? (
        <Empty>No feedback yet.</Empty>
      ) : (
        <div className="card">
          {p.reviews.map((r) => (
            <div key={r.id} className="list-item">
              <div className="body">
                <div className="row-between">
                  <span>
                    <Stars value={r.rating} />{" "}
                    <span className="small muted">
                      from {r.reviewer_name} · {fmtDate(r.created_at)}
                    </span>
                  </span>
                  {viewer && viewer.id !== id && <ReportForm targetType="review" targetId={r.id} label="Report" />}
                </div>
                {r.tags.length > 0 && (
                  <div className="row small" style={{ marginTop: 4 }}>
                    {r.tags.map((t) => (
                      <span key={t} className="badge">
                        {REVIEW_TAGS[t] ?? t}
                      </span>
                    ))}
                  </div>
                )}
                {r.comment && (
                  <p className="mb-0" style={{ marginTop: 6 }}>
                    {r.comment}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {viewer && viewer.id !== id && (
        <div style={{ marginTop: 20 }}>
          <ReportForm targetType="member" targetId={id} label="Report this member" />
        </div>
      )}
    </div>
  );
}
