import Link from "next/link";
import { CONDITIONS, EXCHANGE_STATUS_LABEL, FORMATS, LISTING_STATUS_LABEL, label } from "@/lib/vocab";
import { countryName, COUNTRY_CODES } from "@/lib/countries";
import { authorsText } from "@/lib/format";

function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Generated cover tile. YOS doesn't display catalog cover art without a licence (§20.4). */
export function Cover({ title, authors }: { title: string; authors?: string[] }) {
  const hue = hashHue(title);
  return (
    <div
      className="cover"
      style={{ background: `linear-gradient(160deg, hsl(${hue} 42% 36%), hsl(${(hue + 25) % 360} 45% 50%))` }}
      aria-hidden="true"
    >
      <div className="t">{title}</div>
      <div className="a">{authorsText(authors)}</div>
    </div>
  );
}

export function Photo({ fileId, alt }: { fileId: string; alt: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/files/${fileId}`} alt={alt} loading="lazy" />;
}

export function BookMedia({ title, authors, photoId }: { title: string; authors: string[]; photoId: string | null }) {
  if (photoId) {
    return (
      <div className="cover-photo">
        <Photo fileId={photoId} alt={`Photo of the member's copy of ${title}`} />
      </div>
    );
  }
  return <Cover title={title} authors={authors} />;
}

export function BookCard({
  l,
}: {
  l: { id: string; title: string; authors: string[]; format: string; condition: string; origin_country: string; status: string; photo_id: string | null };
}) {
  return (
    <Link href={`/books/${l.id}`} className="book-card">
      <div className="media">
        <BookMedia title={l.title} authors={l.authors} photoId={l.photo_id} />
        {l.status === "reserved" && <span className="badge badge-warn">Reserved</span>}
      </div>
      <div>
        <div className="title">{l.title}</div>
        <div className="meta">{authorsText(l.authors)}</div>
        <div className="meta">
          {label(FORMATS, l.format)} · {label(CONDITIONS, l.condition)} · {countryName(l.origin_country)}
        </div>
      </div>
    </Link>
  );
}

const EXCHANGE_TONE: Record<string, string> = {
  requested: "warn", accepted: "info", shipped: "info", delivered: "accent", completed: "ok",
  declined: "", expired: "", cancelled: "", disputed: "danger", refunded: "",
};
const LISTING_TONE: Record<string, string> = {
  draft: "", active: "ok", reserved: "warn", unavailable: "", paused: "", exchanged: "accent", removed: "danger", under_review: "danger",
};

export function ExchangeBadge({ status }: { status: string }) {
  return <span className={`badge ${EXCHANGE_TONE[status] ? `badge-${EXCHANGE_TONE[status]}` : ""}`}>{EXCHANGE_STATUS_LABEL[status] ?? status}</span>;
}

export function ListingBadge({ status }: { status: string }) {
  return <span className={`badge ${LISTING_TONE[status] ? `badge-${LISTING_TONE[status]}` : ""}`}>{LISTING_STATUS_LABEL[status] ?? status}</span>;
}

export function Badge({ children, tone }: { children: React.ReactNode; tone?: "ok" | "warn" | "danger" | "info" | "accent" | "warm" }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ""}`}>{children}</span>;
}

export function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <span className="stars" aria-label={`${value.toFixed(1)} out of 5`}>
      {"★".repeat(full)}
      {"☆".repeat(5 - full)}
    </span>
  );
}

export function CountrySelect({
  name = "country",
  defaultValue,
  required = true,
  only,
  id,
  includeBlank = true,
}: {
  name?: string;
  defaultValue?: string | null;
  required?: boolean;
  only?: string[];
  id?: string;
  includeBlank?: boolean;
}) {
  const codes = (only ?? COUNTRY_CODES).map((c) => ({ c, n: countryName(c) })).sort((a, b) => a.n.localeCompare(b.n));
  return (
    <select name={name} id={id ?? name} defaultValue={defaultValue ?? ""} required={required}>
      {includeBlank && <option value="">Choose a country…</option>}
      {codes.map(({ c, n }) => (
        <option key={c} value={c}>
          {n}
        </option>
      ))}
    </select>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Pager({ page, total, pageSize, href }: { page: number; total: number; pageSize: number; href: (p: number) => string }) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Pagination">
      {page > 1 && <Link className="btn btn-sm" href={href(page - 1)}>← Previous</Link>}
      <span className="muted small" style={{ alignSelf: "center" }}>
        Page {page} of {pages}
      </span>
      {page < pages && <Link className="btn btn-sm" href={href(page + 1)}>Next →</Link>}
    </nav>
  );
}

export function Tabs({ items, current }: { items: { href: string; label: React.ReactNode; key: string }[]; current: string }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {items.map((i) => (
        <Link key={i.key} href={i.href} aria-current={i.key === current ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
