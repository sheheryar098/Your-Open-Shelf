import Link from "next/link";
import { CONDITIONS, FORMATS, label } from "@/shared/lib/vocab";
import { countryName } from "@/shared/lib/countries";
import { authorsText } from "@/shared/lib/format";
import { BookMedia } from "@/shared/ui/book-media";

export interface BookCardData {
  id: string;
  title: string;
  authors: string[];
  format: string;
  condition: string;
  origin_country: string;
  status: string;
  photo_id: string | null;
}

export function BookCard({ l }: { l: BookCardData }) {
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
