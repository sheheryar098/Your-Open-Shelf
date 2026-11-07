import Link from "next/link";
import type { ExchangeView } from "@/server/domain/exchanges/queries";
import { DISPUTE_TYPES, EXCHANGE_STATUS_LABEL, REVIEW_TAGS } from "@/shared/lib/vocab";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { Stars } from "@/shared/ui/primitives";
import { openDisputeAction, reviewAction } from "../api/actions";

export function ReportProblem({ exchangeId }: { exchangeId: string }) {
  return (
    <section className="card card-flat">
      <details>
        <summary>Report a problem with this exchange</summary>
        <p className="small">
          Opening a dispute puts the exchange on hold. Support looks at the listing, messages, tracking and evidence
          from both of you.
        </p>
        <ActionForm action={openDisputeAction.bind(null, exchangeId)} encType="multipart/form-data">
          <div className="field">
            <label htmlFor="issueType">What went wrong?</label>
            <select id="issueType" name="issueType" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {Object.entries(DISPUTE_TYPES).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="description">Describe the problem</label>
            <textarea id="description" name="description" required minLength={20} maxLength={4000} />
          </div>
          <div className="field">
            <label htmlFor="evidence">Evidence (optional)</label>
            <input id="evidence" name="evidence" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" />
            <span className="help">Photos of the book and packaging, tracking screenshots or carrier messages.</span>
          </div>
          <SubmitButton className="btn btn-danger">Open dispute</SubmitButton>
        </ActionForm>
      </details>
    </section>
  );
}

export function UnderReview({ dispute }: { dispute: { id: string; issue_type: string } }) {
  return (
    <section className="card">
      <h2>Under review</h2>
      <p>
        There&apos;s an open dispute: <strong>{DISPUTE_TYPES[dispute.issue_type]}</strong>. No credits move until
        support decides.
      </p>
      <Link href={`/disputes/${dispute.id}`} className="btn">
        Open the case
      </Link>
    </section>
  );
}

export function ClosedSummary({ view }: { view: ExchangeView }) {
  const { exchange: e, viewer, disputes } = view;
  return (
    <section className="card">
      <h2>{EXCHANGE_STATUS_LABEL[e.status]}</h2>
      {e.close_reason && <p>{e.close_reason}</p>}
      {viewer.isRequester && <p className="small">Your reserved credit went back to your wallet.</p>}
      {disputes[0] && <Link href={`/disputes/${disputes[0].id}`}>View the dispute decision →</Link>}
    </section>
  );
}

export function CompletedSummary({ view, viewerId }: { view: ExchangeView; viewerId: string }) {
  const { exchange: e, viewer, reviews } = view;
  const counterpart = viewer.isRequester ? e.sender_name : e.requester_name;
  const mine = reviews.find((r) => r.reviewer_id === viewerId);
  const theirs = reviews.find((r) => r.reviewer_id !== viewerId);
  const isParty = viewer.isRequester || viewer.isSender;

  return (
    <section className="card">
      <h2>Exchange completed</h2>
      <p>
        {viewer.isSender
          ? "You earned 1 credit for sending this book. Thank you!"
          : "Enjoy your book! Your credit was spent on this exchange."}
      </p>
      {isParty && !mine && <ReviewForm exchangeId={e.id} counterpart={counterpart} />}
      {mine && (
        <p className="small">
          Your feedback: <Stars value={mine.rating} /> {mine.comment}
        </p>
      )}
      {theirs && (
        <p className="small">
          {counterpart}&apos;s feedback: <Stars value={theirs.rating} /> {theirs.comment}
        </p>
      )}
    </section>
  );
}

function ReviewForm({ exchangeId, counterpart }: { exchangeId: string; counterpart: string }) {
  return (
    <ActionForm action={reviewAction.bind(null, exchangeId)}>
      <h3>Rate your exchange with {counterpart}</h3>
      <div className="field">
        <label htmlFor="rating">Overall</label>
        <select id="rating" name="rating" required defaultValue="5">
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {"★".repeat(n)} {n}
            </option>
          ))}
        </select>
      </div>
      <fieldset>
        <legend className="small">Tags (optional)</legend>
        <div className="row">
          {Object.entries(REVIEW_TAGS).map(([value, text]) => (
            <label key={value} className="check small">
              <input type="checkbox" name="tags" value={value} /> {text}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="comment">Comment (optional)</label>
        <textarea id="comment" name="comment" maxLength={1000} rows={3} />
      </div>
      <SubmitButton>Submit feedback</SubmitButton>
    </ActionForm>
  );
}
