import Link from "next/link";
import type { ListingDetail } from "@/server/domain/listings";
import { countryName } from "@/shared/lib/countries";
import { authorsText, fmtDate } from "@/shared/lib/format";
import { CONDITIONS, FORMATS, LANGUAGES, label } from "@/shared/lib/vocab";
import { Badge } from "@/shared/ui/primitives";
import { Cover, Photo } from "@/shared/ui/book-media";
import { ListingBadge } from "./ListingBadge";

export function ListingGallery({ listing }: { listing: ListingDetail }) {
  const [first, ...rest] = listing.photos;
  return (
    <div className="stack-sm">
      {first ? (
        <div className="cover-photo">
          <Photo fileId={first.file_id} alt={`Photo of this copy of ${listing.title}`} />
        </div>
      ) : (
        <Cover title={listing.title} authors={listing.authors} />
      )}
      <p className="tiny muted">Photos show the member&apos;s actual copy.</p>
      {rest.length > 0 && (
        <div className="gallery">
          {rest.map((photo, i) => (
            <a key={photo.id} href={`/files/${photo.file_id}`} target="_blank" rel="noreferrer">
              <Photo fileId={photo.file_id} alt={`Photo ${i + 2} of this copy`} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function ListingFacts({ listing, destinations }: { listing: ListingDetail; destinations: string[] }) {
  const l = listing;
  const edition = [l.edition, l.edition_notes].filter(Boolean).join(" · ");
  return (
    <div>
      <div className="row">
        <ListingBadge status={l.status} />
        {l.category_name && <Badge>{l.category_name}</Badge>}
      </div>
      <h1 style={{ marginTop: 10 }}>{l.title}</h1>
      {l.subtitle && <p className="lede">{l.subtitle}</p>}
      <p>by {authorsText(l.authors)}</p>
      <dl className="dl">
        <dt>Format</dt>
        <dd>{label(FORMATS, l.format)}</dd>
        <dt>Language</dt>
        <dd>{LANGUAGES[l.language] ?? l.language}</dd>
        <dt>Condition</dt>
        <dd>
          <strong>{label(CONDITIONS, l.condition)}</strong>.{" "}
          <span className="muted">{CONDITIONS[l.condition]?.guidance}</span>
        </dd>
        {edition && (
          <>
            <dt>Edition</dt>
            <dd>{edition}</dd>
          </>
        )}
        {l.isbn13 && (
          <>
            <dt>ISBN</dt>
            <dd className="mono">{l.isbn13}</dd>
          </>
        )}
        {l.publisher ? (
          <>
            <dt>Publisher</dt>
            <dd>
              {l.publisher}
              {l.publication_year ? `, ${l.publication_year}` : ""}
            </dd>
          </>
        ) : (
          l.publication_year && (
            <>
              <dt>First published</dt>
              <dd>{l.publication_year}</dd>
            </>
          )
        )}
        <dt>Ships from</dt>
        <dd>{countryName(l.origin_country)}</dd>
        <dt>Ships to</dt>
        <dd>
          {destinations.length ? (
            destinations.map((d) => countryName(d)).join(", ")
          ) : (
            <span className="muted">No supported routes right now</span>
          )}
        </dd>
        <dt>Listed</dt>
        <dd>{fmtDate(l.published_at ?? l.created_at)}</dd>
        <dt>Cost</dt>
        <dd>
          <strong>1 YOS credit</strong> <span className="muted small">· sender pays postage</span>
        </dd>
      </dl>
    </div>
  );
}

export function ConditionNotes({ notes }: { notes: string }) {
  return (
    <section className="card">
      <h2>Condition notes from the member</h2>
      <p style={{ whiteSpace: "pre-wrap" }}>{notes}</p>
      <p className="small muted mb-0">
        The member describes the condition; YOS doesn&apos;t inspect books. If yours arrives noticeably different, you
        can open a dispute. <Link href="/condition-guide">Condition guide</Link>
      </p>
    </section>
  );
}
