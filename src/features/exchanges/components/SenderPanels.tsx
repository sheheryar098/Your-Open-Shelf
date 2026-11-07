import Link from "next/link";
import type { ExchangeView } from "@/server/domain/exchanges/queries";
import { policy } from "@/server/config";
import { countryName, formatPostageRange } from "@/shared/lib/countries";
import { fmtDateTime, relative } from "@/shared/lib/format";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { acceptAction, declineAction, senderCancelAction, shipAction } from "../api/actions";

export function RespondToRequest({ view }: { view: ExchangeView }) {
  const { exchange: e, route, addressSummary } = view;
  const destination = [addressSummary?.city, addressSummary?.region].filter(Boolean).join(", ");
  const postage = route && formatPostageRange(route);

  return (
    <section className="card">
      <h2>New request, respond {relative(e.respond_by)}</h2>
      <p>
        {e.requester_name} would like your book, delivered to{" "}
        <strong>
          {destination}, {countryName(e.destination_country)}
        </strong>
        . You&apos;ll see the full address once you accept.
      </p>
      <div className="callout callout-warm small">
        <p>
          <strong>You pay the postage.</strong>{" "}
          {postage ? (
            <>Typical cost on this route is {postage}. That&apos;s an estimate, not a quote, so check your carrier.</>
          ) : (
            <>We don&apos;t have a postage estimate for this route yet. Check your carrier&apos;s prices first.</>
          )}
        </p>
        {route?.tracking_required && (
          <p>
            This route needs a <strong>tracked</strong> service.
          </p>
        )}
        {route?.customs_notice && <p>{route.customs_notice}</p>}
        <p>
          If you accept, ship within {policy.dispatchBusinessDays} business days. You earn 1 credit when the exchange
          completes.
        </p>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <ActionForm action={acceptAction.bind(null, e.id)} className="inline-form">
          <SubmitButton>Accept request</SubmitButton>
        </ActionForm>
      </div>
      <details style={{ marginTop: 12 }}>
        <summary>Decline</summary>
        <ActionForm action={declineAction.bind(null, e.id)}>
          <div className="field">
            <label htmlFor="reason">Message to the requester (optional)</label>
            <input id="reason" name="reason" type="text" maxLength={500} />
          </div>
          <label className="check small">
            <input type="checkbox" name="noLongerAvailable" />
            <span>I no longer have this book, so mark the listing unavailable</span>
          </label>
          <SubmitButton className="btn btn-danger">Decline request</SubmitButton>
        </ActionForm>
      </details>
    </section>
  );
}

export function ShipBook({ view, timeZone, today }: { view: ExchangeView; timeZone: string; today: string }) {
  const { exchange: e, route, address } = view;
  const trackingRequired = !!route?.tracking_required;

  return (
    <section className="card">
      <h2>Ship the book, due {relative(e.dispatch_by)}</h2>
      {address && (
        <div className="callout">
          <p className="small muted mb-0">Deliver to (for this exchange only):</p>
          <address style={{ fontStyle: "normal", whiteSpace: "pre-line" }}>
            {[
              address.recipient_name,
              address.line1,
              address.line2,
              [address.city, address.region, address.postal_code].filter(Boolean).join(", "),
              countryName(address.country_code),
              address.phone,
            ]
              .filter(Boolean)
              .join("\n")}
          </address>
        </div>
      )}
      <p className="small" style={{ marginTop: 12 }}>
        Pack it carefully (<Link href="/condition-guide#packing">packing tips</Link>).{" "}
        {route?.customs_required && "Fill in the customs form truthfully: the contents are a used book. "}
        Dispatch by {fmtDateTime(e.dispatch_by, timeZone)}.
      </p>

      <ActionForm action={shipAction.bind(null, e.id)} encType="multipart/form-data">
        <div className="field-row">
          <div className="field">
            <label htmlFor="carrier">Carrier and service</label>
            <input id="carrier" name="carrier" type="text" required placeholder="e.g. Royal Mail Tracked 48" />
          </div>
          <div className="field">
            <label htmlFor="dispatchDate">Dispatch date</label>
            <input id="dispatchDate" name="dispatchDate" type="date" required defaultValue={today} max={today} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="trackingNumber">Tracking number{trackingRequired ? "" : " (strongly recommended)"}</label>
          <input id="trackingNumber" name="trackingNumber" type="text" required={trackingRequired} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="trackingUrl">Carrier tracking link (optional)</label>
          <input id="trackingUrl" name="trackingUrl" type="url" placeholder="https://…" />
        </div>
        {!trackingRequired && (
          <div className="field">
            <label htmlFor="proof">Proof of postage (required if you don&apos;t have tracking)</label>
            <input id="proof" name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" />
            <span className="help">A photo of your receipt. Only {e.requester_name} and YOS support can see it.</span>
          </div>
        )}
        <SubmitButton pendingText="Saving…">Mark as shipped</SubmitButton>
      </ActionForm>

      <details style={{ marginTop: 16 }}>
        <summary className="small">I can&apos;t send this book</summary>
        <ActionForm
          action={senderCancelAction.bind(null, e.id)}
          confirm="Cancel this exchange? The requester gets their credit back and it counts against your dispatch record."
        >
          <div className="field">
            <label htmlFor="cancelReason">What happened?</label>
            <input id="cancelReason" name="reason" type="text" required minLength={5} maxLength={500} />
          </div>
          <SubmitButton className="btn btn-danger btn-sm">Cancel exchange</SubmitButton>
        </ActionForm>
      </details>
    </section>
  );
}
