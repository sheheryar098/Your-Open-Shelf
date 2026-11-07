import Link from "next/link";
import type { ExchangeView } from "@/server/domain/exchanges/queries";
import { countryName } from "@/shared/lib/countries";
import { authorsText, shortId } from "@/shared/lib/format";
import { CONDITIONS, FORMATS, label } from "@/shared/lib/vocab";
import { BookMedia } from "@/shared/ui/book-media";
import { ExchangeBadge } from "./ExchangeBadge";

const STEPS = ["requested", "accepted", "shipped", "delivered", "completed"] as const;
const CLOSED = new Set(["declined", "expired", "cancelled", "refunded"]);

export function ExchangeHeader({ view }: { view: ExchangeView }) {
  const { exchange: e, viewer } = view;
  const counterpart = viewer.isRequester ? (
    <>
      From <Link href={`/members/${e.sender_id}`}>{e.sender_name}</Link>
    </>
  ) : (
    <>
      To <Link href={`/members/${e.requester_id}`}>{e.requester_name}</Link>
    </>
  );

  return (
    <>
      <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
        <div style={{ width: 110, flex: "none" }}>
          <BookMedia title={e.title} authors={e.authors} photoId={e.photo_id} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row">
            <ExchangeBadge status={e.status} />
            <span className="small muted">Exchange #{shortId(e.id)}</span>
          </div>
          <h1 style={{ marginTop: 8 }}>
            <Link href={`/books/${e.listing_id}`} style={{ color: "inherit" }}>
              {e.title}
            </Link>
          </h1>
          <div className="muted">
            {authorsText(e.authors)} · {label(FORMATS, e.format)} · {label(CONDITIONS, e.condition)}
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            {counterpart} · {countryName(e.origin_country)} → {countryName(e.destination_country)} · {e.credit_cost}{" "}
            credit
          </div>
        </div>
      </div>
      {!CLOSED.has(e.status) && <Progress status={e.status} statusBeforeDispute={e.status_before_dispute} />}
    </>
  );
}

function Progress({ status, statusBeforeDispute }: { status: string; statusBeforeDispute: string | null }) {
  const effective = status === "disputed" ? (statusBeforeDispute ?? "shipped") : status;
  const reached = STEPS.indexOf(effective as (typeof STEPS)[number]);
  return (
    <div>
      <div className="progress" aria-hidden="true">
        {STEPS.map((step, i) => (
          <span key={step} className={i <= reached ? "done" : ""} />
        ))}
      </div>
      <div className="progress-labels">
        <span>Requested</span>
        <span>Accepted</span>
        <span>Shipped</span>
        <span>Delivered</span>
        <span>Completed</span>
      </div>
    </div>
  );
}
