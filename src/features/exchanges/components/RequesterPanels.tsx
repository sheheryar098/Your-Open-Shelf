import type { ExchangeView } from "@/server/domain/exchanges/queries";
import { policy } from "@/server/config";
import { fmtDate, fmtDateTime } from "@/shared/lib/format";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { cancelRequestAction, confirmReceiptAction } from "../api/actions";

export function AwaitingResponse({ view, timeZone }: { view: ExchangeView; timeZone: string }) {
  const { exchange: e } = view;
  return (
    <section className="card">
      <h2>Waiting for {e.sender_name}</h2>
      <p>
        They have until {fmtDateTime(e.respond_by, timeZone)} to respond. If they don&apos;t, your credit comes back
        automatically.
      </p>
      <ActionForm
        action={cancelRequestAction.bind(null, e.id)}
        confirm="Cancel this request? Your credit will be returned."
        className="inline-form"
      >
        <SubmitButton className="btn btn-danger btn-sm">Cancel request</SubmitButton>
      </ActionForm>
    </section>
  );
}

export function AwaitingDispatch({ view, timeZone }: { view: ExchangeView; timeZone: string }) {
  const { exchange: e } = view;
  return (
    <section className="card">
      <h2>Accepted. {e.sender_name} is preparing your book</h2>
      <p>
        They&apos;ll dispatch it by {fmtDateTime(e.dispatch_by, timeZone)}. If they don&apos;t, the exchange is
        cancelled and your credit comes back.
      </p>
    </section>
  );
}

export function ConfirmReceipt({ view, timeZone }: { view: ExchangeView; timeZone: string }) {
  const { exchange: e } = view;
  const confirmedBy =
    e.delivery_confirmed_by === "auto" ? "after the route's delivery window passed" : `by ${e.delivery_confirmed_by}`;

  return (
    <section className="card">
      <h2>{e.status === "delivered" ? "Delivered. Is everything OK?" : "On its way to you"}</h2>
      {e.status === "delivered" && e.completion_due_at && (
        <p>
          Delivery was confirmed {confirmedBy}. If something&apos;s wrong, report it before{" "}
          {fmtDateTime(e.completion_due_at, timeZone)}. Otherwise the exchange completes automatically.
        </p>
      )}
      {e.status === "shipped" && e.auto_confirm_at && (
        <p className="small muted">
          If you don&apos;t confirm, we treat the tracked parcel as delivered after{" "}
          {fmtDate(e.auto_confirm_at, timeZone)}, and you then have {policy.disputeWindowDays} days to report a problem.
        </p>
      )}
      <ActionForm
        action={confirmReceiptAction.bind(null, e.id)}
        confirm="Confirm the book arrived and matches the listing? This completes the exchange."
      >
        <SubmitButton>I received it and it&apos;s as described</SubmitButton>
      </ActionForm>
    </section>
  );
}
