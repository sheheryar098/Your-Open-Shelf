import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { listingsForOwner } from "@/domain/listings";
import { CONDITIONS, FORMATS, label } from "@/lib/vocab";
import { fmtDate } from "@/lib/format";
import { BookMedia, Empty, ListingBadge, Tabs } from "@/components/ui";

export const metadata = { title: "My books" };

const GROUPS: Record<string, { label: string; statuses: string[] }> = {
  active: { label: "Active", statuses: ["active"] },
  reserved: { label: "Reserved & unavailable", statuses: ["reserved", "unavailable", "paused", "under_review"] },
  drafts: { label: "Drafts", statuses: ["draft"] },
  history: { label: "Listing history", statuses: ["exchanged"] },
};

export default async function MyBooks({ searchParams }: { searchParams: Promise<{ tab?: string; removed?: string }> }) {
  const u = await requireUser("/my/books");
  const sp = await searchParams;
  const tab = sp.tab ?? "active";
  const all = await listingsForOwner(u.id);
  const g = GROUPS[tab] ?? GROUPS.active;
  const items = all.filter((l) => g.statuses.includes(l.status));
  return (
    <div className="container page">
      <div className="row-between">
        <h1 className="mb-0">My books</h1>
        <Link href="/my/books/new" className="btn btn-primary">Add a book</Link>
      </div>
      {sp.removed && <div className="alert alert-ok" style={{ marginTop: 12 }}>Listing removed.</div>}
      <div style={{ marginTop: 16 }}>
        <Tabs current={tab} items={Object.entries(GROUPS).map(([k, v]) => ({ key: k, href: `/my/books?tab=${k}`, label: `${v.label} (${all.filter((l) => v.statuses.includes(l.status)).length})` }))} />
      </div>
      {items.length === 0 ? (
        <Empty>{tab === "active" ? <>No active listings. <Link href="/my/books/new">List your first book</Link> to start earning credits.</> : "Nothing here."}</Empty>
      ) : (
        <div className="card">
          {items.map((l) => (
            <div key={l.id} className="list-item">
              <div className="thumb"><BookMedia title={l.title} authors={l.authors} photoId={l.photo_id} /></div>
              <div className="body">
                <Link href={`/my/books/${l.id}`} className="title">{l.title}</Link>
                <div className="small muted">{label(FORMATS, l.format)} · {label(CONDITIONS, l.condition)} · listed {fmtDate(l.published_at ?? l.updated_at)}</div>
                <div className="small muted">{l.request_count} request{l.request_count === 1 ? "" : "s"} so far{l.status_reason ? ` · ${l.status_reason}` : ""}</div>
              </div>
              <div className="stack-sm right">
                <ListingBadge status={l.status} />
                <div><Link href={`/my/books/${l.id}`} className="btn btn-sm">Manage</Link></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
