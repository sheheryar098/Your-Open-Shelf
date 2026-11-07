import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getExchangeForViewer } from "@/domain/exchanges";
import { runJobsIfDue } from "@/domain/jobs";
import { countryName, formatMoney } from "@/lib/countries";
import { CONDITIONS, DISPUTE_TYPES, EXCHANGE_STATUS_LABEL, FORMATS, REVIEW_TAGS, label } from "@/lib/vocab";
import { authorsText, fmtDate, fmtDateTime, relative, shortId } from "@/lib/format";
import { policy } from "@/lib/config";
import { now } from "@/lib/clock";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BookMedia, ExchangeBadge, Stars } from "@/components/ui";
import { ReportForm } from "@/components/ReportForm";
import {
  acceptAction, cancelRequestAction, confirmReceiptAction, declineAction, messageAction, openDisputeAction,
  reviewAction, senderCancelAction, shipAction,
} from "@/app/actions/exchanges";

export const metadata = { title: "Exchange" };

const STEPS = ["requested", "accepted", "shipped", "delivered", "completed"];

export default async function ExchangePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ requested?: string }> }) {
  const u = await requireUser("/dashboard");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await runJobsIfDue();
  const data = await getExchangeForViewer(id, u);
  if (!data) notFound();
  const { exchange: e, route, shipment, events, messages, disputes, reviews, address, addressSummary, viewer } = data;
  const tz = u.timezone;
  const reached = Math.max(STEPS.indexOf(e.status), e.status === "disputed" ? STEPS.indexOf(e.status_before_dispute ?? "shipped") : -1);
  const myReview = reviews.find((r) => r.reviewer_id === u.id);
  const theirReview = reviews.find((r) => r.reviewer_id !== u.id);
  const openDispute = disputes.find((d) => d.status !== "resolved");
  const counterpart = viewer.isRequester ? e.sender_name : e.requester_name;
  const today = now().toISOString().slice(0, 10);

  return (
    <div className="container page stack-lg">
      <p className="small">
        <Link href={viewer.isSender ? "/my/shipments" : "/my/requests"}>← {viewer.isSender ? "My shipments" : "My requests"}</Link>
        {viewer.isStaff && !viewer.isRequester && !viewer.isSender && <> · <Link href={`/admin/exchanges/${e.id}`}>Staff view</Link></>}
      </p>
      {sp.requested && <div className="alert alert-ok">Request sent! 1 credit is reserved. {e.sender_name} has {policy.senderResponseDays} days to respond.</div>}

      <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
        <div style={{ width: 110, flex: "none" }}><BookMedia title={e.title} authors={e.authors} photoId={e.photo_id} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row"><ExchangeBadge status={e.status} /><span className="small muted">Exchange #{shortId(e.id)}</span></div>
          <h1 style={{ marginTop: 8 }}><Link href={`/books/${e.listing_id}`} style={{ color: "inherit" }}>{e.title}</Link></h1>
          <div className="muted">{authorsText(e.authors)} · {label(FORMATS, e.format)} · {label(CONDITIONS, e.condition)}</div>
          <div className="small" style={{ marginTop: 6 }}>
            {viewer.isRequester ? <>From <Link href={`/members/${e.sender_id}`}>{e.sender_name}</Link></> : <>To <Link href={`/members/${e.requester_id}`}>{e.requester_name}</Link></>}
            {" "}· {countryName(e.origin_country)} → {countryName(e.destination_country)} · {e.credit_cost} credit
          </div>
        </div>
      </div>

      {!["declined", "expired", "cancelled", "refunded"].includes(e.status) && (
        <div>
          <div className="progress" aria-hidden="true">{STEPS.map((s, i) => <span key={s} className={i <= reached ? "done" : ""} />)}</div>
          <div className="progress-labels"><span>Requested</span><span>Accepted</span><span>Shipped</span><span>Delivered</span><span>Completed</span></div>
        </div>
      )}

      <div className="split">
        <div className="stack">
          {/* ------------------------------------------------------------ Action panel */}
          {viewer.isSender && e.status === "requested" && (
            <section className="card">
              <h2>New request — respond {relative(e.respond_by)}</h2>
              <p>
                {e.requester_name} would like your book, delivered to <strong>{[addressSummary?.city, addressSummary?.region].filter(Boolean).join(", ")}, {countryName(e.destination_country)}</strong>.
                The full address is shown once you accept.
              </p>
              <div className="callout callout-warm small">
                <p><strong>You pay the postage.</strong>{" "}
                  {route?.postage_estimate_min
                    ? <>Indicative cost on this route: {formatMoney(route.postage_estimate_min, route.postage_currency)}–{formatMoney(route.postage_estimate_max, route.postage_currency)} (an estimate, not a quote — check your carrier).</>
                    : <>We don&apos;t have a verified postage estimate for this route yet — check your carrier&apos;s prices before accepting.</>}
                </p>
                {route?.tracking_required && <p>This route requires a <strong>tracked</strong> service.</p>}
                {route?.customs_notice && <p>{route.customs_notice}</p>}
                <p>If you accept, ship within {policy.dispatchBusinessDays} business days. You earn 1 credit when the exchange completes.</p>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <ActionForm action={acceptAction.bind(null, e.id)} className="inline-form">
                  <SubmitButton>Accept request</SubmitButton>
                </ActionForm>
              </div>
              <details style={{ marginTop: 12 }}>
                <summary>Decline</summary>
                <ActionForm action={declineAction.bind(null, e.id)}>
                  <div className="field"><label htmlFor="reason">Message to the requester (optional)</label><input id="reason" name="reason" type="text" maxLength={500} /></div>
                  <label className="check small"><input type="checkbox" name="noLongerAvailable" /> <span>I no longer have this book — mark the listing unavailable</span></label>
                  <SubmitButton className="btn btn-danger">Decline request</SubmitButton>
                </ActionForm>
              </details>
            </section>
          )}

          {viewer.isRequester && e.status === "requested" && (
            <section className="card">
              <h2>Waiting for {e.sender_name}</h2>
              <p>They have until {fmtDateTime(e.respond_by, tz)} to respond. If they don&apos;t, your credit is returned automatically.</p>
              <ActionForm action={cancelRequestAction.bind(null, e.id)} confirm="Cancel this request? Your credit will be returned." className="inline-form">
                <SubmitButton className="btn btn-danger btn-sm">Cancel request</SubmitButton>
              </ActionForm>
            </section>
          )}

          {viewer.isSender && e.status === "accepted" && (
            <section className="card">
              <h2>Ship the book — due {relative(e.dispatch_by)}</h2>
              {address && (
                <div className="callout">
                  <p className="small muted mb-0">Deliver to (use only for this exchange):</p>
                  <address style={{ fontStyle: "normal", whiteSpace: "pre-line" }}>
                    {[address.recipient_name, address.line1, address.line2, [address.city, address.region, address.postal_code].filter(Boolean).join(", "), countryName(address.country_code), address.phone].filter(Boolean).join("\n")}
                  </address>
                </div>
              )}
              <p className="small" style={{ marginTop: 12 }}>
                Pack it carefully (<Link href="/condition-guide#packing">packing tips</Link>). {route?.customs_required && "Complete a truthful customs declaration describing the contents as a used book. "}
                Dispatch by {fmtDateTime(e.dispatch_by, tz)}.
              </p>
              <ActionForm action={shipAction.bind(null, e.id)} encType="multipart/form-data">
                <div className="field-row">
                  <div className="field"><label htmlFor="carrier">Carrier / service</label><input id="carrier" name="carrier" type="text" required placeholder="e.g. Royal Mail Tracked 48" /></div>
                  <div className="field"><label htmlFor="dispatchDate">Dispatch date</label><input id="dispatchDate" name="dispatchDate" type="date" required defaultValue={today} max={today} /></div>
                </div>
                <div className="field">
                  <label htmlFor="trackingNumber">Tracking number{route?.tracking_required ? "" : " (strongly recommended)"}</label>
                  <input id="trackingNumber" name="trackingNumber" type="text" required={route?.tracking_required} autoComplete="off" />
                </div>
                <div className="field">
                  <label htmlFor="trackingUrl">Carrier tracking link (optional)</label>
                  <input id="trackingUrl" name="trackingUrl" type="url" placeholder="https://…" />
                </div>
                {!route?.tracking_required && (
                  <div className="field">
                    <label htmlFor="proof">Proof of postage {route?.tracking_required ? "" : "(required if you don't have tracking)"}</label>
                    <input id="proof" name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" />
                    <span className="help">A photo of your receipt. Only visible to {e.requester_name} and YOS support.</span>
                  </div>
                )}
                <SubmitButton pendingText="Saving…">Mark as shipped</SubmitButton>
              </ActionForm>
              <details style={{ marginTop: 16 }}>
                <summary className="small">I can&apos;t send this book</summary>
                <ActionForm action={senderCancelAction.bind(null, e.id)} confirm="Cancel this exchange? The requester's credit will be returned and this counts against your dispatch record.">
                  <div className="field"><label htmlFor="cancelReason">What happened?</label><input id="cancelReason" name="reason" type="text" required minLength={5} maxLength={500} /></div>
                  <SubmitButton className="btn btn-danger btn-sm">Cancel exchange</SubmitButton>
                </ActionForm>
              </details>
            </section>
          )}

          {viewer.isRequester && e.status === "accepted" && (
            <section className="card">
              <h2>Accepted — {e.sender_name} is preparing your book</h2>
              <p>They&apos;ll dispatch it by {fmtDateTime(e.dispatch_by, tz)}. If they don&apos;t, the exchange is cancelled and your credit returned.</p>
            </section>
          )}

          {(e.status === "shipped" || e.status === "delivered") && viewer.isRequester && (
            <section className="card">
              <h2>{e.status === "delivered" ? "Delivered — is everything OK?" : "On its way to you"}</h2>
              {e.status === "delivered" && e.completion_due_at && (
                <p>Delivery was confirmed {e.delivery_confirmed_by === "auto" ? "after the route's delivery window passed" : `by ${e.delivery_confirmed_by}`}. If there&apos;s a problem, report it before {fmtDateTime(e.completion_due_at, tz)}; otherwise the exchange completes automatically.</p>
              )}
              {e.status === "shipped" && e.auto_confirm_at && <p className="small muted">If you don&apos;t confirm, tracked delivery is assumed after {fmtDate(e.auto_confirm_at, tz)} and a {policy.disputeWindowDays}-day window to report problems follows.</p>}
              <ActionForm action={confirmReceiptAction.bind(null, e.id)} confirm="Confirm you received the book and it matches the listing? This completes the exchange.">
                <SubmitButton>I received it and it&apos;s as described</SubmitButton>
              </ActionForm>
            </section>
          )}

          {(e.status === "shipped" || e.status === "delivered") && (
            <section className="card card-flat">
              <details>
                <summary>Report a problem with this exchange</summary>
                <p className="small">Opening a dispute pauses the exchange. Support reviews the listing, messages, tracking and evidence from both members.</p>
                <ActionForm action={openDisputeAction.bind(null, e.id)} encType="multipart/form-data">
                  <div className="field">
                    <label htmlFor="issueType">What went wrong?</label>
                    <select id="issueType" name="issueType" required defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {Object.entries(DISPUTE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="field"><label htmlFor="description">Describe the problem</label><textarea id="description" name="description" required minLength={20} maxLength={4000} /></div>
                  <div className="field">
                    <label htmlFor="evidence">Evidence (optional)</label>
                    <input id="evidence" name="evidence" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" />
                    <span className="help">Photos of the book and packaging, tracking screenshots or carrier messages.</span>
                  </div>
                  <SubmitButton className="btn btn-danger">Open dispute</SubmitButton>
                </ActionForm>
              </details>
            </section>
          )}

          {e.status === "disputed" && openDispute && (
            <section className="card">
              <h2>Under review</h2>
              <p>A dispute is open: <strong>{DISPUTE_TYPES[openDispute.issue_type]}</strong>. No credits move until support decides.</p>
              <Link href={`/disputes/${openDispute.id}`} className="btn">Open the case</Link>
            </section>
          )}

          {["declined", "expired", "cancelled", "refunded"].includes(e.status) && (
            <section className="card">
              <h2>{EXCHANGE_STATUS_LABEL[e.status]}</h2>
              {e.close_reason && <p>{e.close_reason}</p>}
              {viewer.isRequester && <p className="small">Your reserved credit was returned to your wallet.</p>}
              {disputes[0] && <Link href={`/disputes/${disputes[0].id}`}>View the dispute decision →</Link>}
            </section>
          )}

          {e.status === "completed" && (
            <section className="card">
              <h2>Exchange completed</h2>
              <p>{viewer.isSender ? "You earned 1 credit for sending this book. Thank you!" : "Enjoy your book! Your credit was spent on this exchange."}</p>
              {(viewer.isRequester || viewer.isSender) && !myReview && (
                <ActionForm action={reviewAction.bind(null, e.id)}>
                  <h3>Rate your exchange with {counterpart}</h3>
                  <div className="field">
                    <label htmlFor="rating">Overall</label>
                    <select id="rating" name="rating" required defaultValue="5">
                      {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)} {n}</option>)}
                    </select>
                  </div>
                  <fieldset>
                    <legend className="small">Tags (optional)</legend>
                    <div className="row">
                      {Object.entries(REVIEW_TAGS).map(([k, v]) => <label key={k} className="check small"><input type="checkbox" name="tags" value={k} /> {v}</label>)}
                    </div>
                  </fieldset>
                  <div className="field"><label htmlFor="comment">Comment (optional)</label><textarea id="comment" name="comment" maxLength={1000} rows={3} /></div>
                  <SubmitButton>Submit feedback</SubmitButton>
                </ActionForm>
              )}
              {myReview && <p className="small">Your feedback: <Stars value={myReview.rating} /> {myReview.comment}</p>}
              {theirReview && <p className="small">{counterpart}&apos;s feedback: <Stars value={theirReview.rating} /> {theirReview.comment}</p>}
            </section>
          )}

          {/* ------------------------------------------------------------ Messages */}
          {(viewer.isRequester || viewer.isSender || messages.length > 0) && (
            <section className="card" id="messages">
              <h2>Messages</h2>
              <p className="small muted">Keep conversation about this exchange. Never share payment details or pay outside YOS.</p>
              {messages.length > 0 && (
                <div className="messages">
                  {messages.map((m) => (
                    <div key={m.id} className={`msg ${m.sender_id === u.id ? "mine" : ""}`}>
                      <div className="who">{m.sender_id === u.id ? "You" : m.sender_name} · {fmtDateTime(m.created_at, tz)}</div>
                      {m.body}
                      {m.sender_id !== u.id && (viewer.isRequester || viewer.isSender) && <ReportForm targetType="message" targetId={m.id} label="Report" />}
                    </div>
                  ))}
                </div>
              )}
              {(viewer.isRequester || viewer.isSender) && (
                <ActionForm action={messageAction.bind(null, e.id)} resetOnSuccess className="stack-sm">
                  <label htmlFor="body" className="sr-only">Message</label>
                  <textarea id="body" name="body" rows={3} required maxLength={2000} placeholder={`Message ${counterpart}…`} />
                  <SubmitButton className="btn btn-sm">Send</SubmitButton>
                </ActionForm>
              )}
            </section>
          )}
        </div>

        <aside className="stack">
          {shipment && (
            <section className="card">
              <h3>Shipment</h3>
              <dl className="dl">
                <dt>Carrier</dt><dd>{shipment.carrier}</dd>
                <dt>Dispatched</dt><dd>{fmtDate(shipment.dispatch_date)}</dd>
                <dt>Tracking</dt>
                <dd>{shipment.tracking_number ? <span className="mono">{shipment.tracking_number}</span> : <span className="muted">Untracked</span>}</dd>
                {shipment.proof_file_id && <><dt>Proof</dt><dd><a href={`/files/${shipment.proof_file_id}`} target="_blank" rel="noreferrer">Proof of postage</a></dd></>}
              </dl>
              {shipment.tracking_url && <a href={shipment.tracking_url} target="_blank" rel="noreferrer noopener" className="btn btn-sm" style={{ marginTop: 12 }}>Open carrier tracking ↗</a>}
            </section>
          )}
          <section className="card">
            <h3>Details</h3>
            <dl className="dl small">
              <dt>Requested</dt><dd>{fmtDateTime(e.requested_at, tz)}</dd>
              {e.accepted_at && <><dt>Accepted</dt><dd>{fmtDateTime(e.accepted_at, tz)}</dd></>}
              {e.status === "accepted" && e.dispatch_by && <><dt>Ship by</dt><dd>{fmtDateTime(e.dispatch_by, tz)}</dd></>}
              {e.shipped_at && <><dt>Shipped</dt><dd>{fmtDateTime(e.shipped_at, tz)}</dd></>}
              {e.delivered_at && <><dt>Delivered</dt><dd>{fmtDateTime(e.delivered_at, tz)}</dd></>}
              {e.completed_at && <><dt>Completed</dt><dd>{fmtDateTime(e.completed_at, tz)}</dd></>}
              {route && route.min_delivery_days != null && <><dt>Typical delivery</dt><dd>{route.min_delivery_days}–{route.max_delivery_days} days</dd></>}
            </dl>
          </section>
          <section className="card card-flat">
            <h3>Timeline</h3>
            <ul className="timeline">
              {events.map((ev, i) => (
                <li key={i}>
                  <strong>{EXCHANGE_STATUS_LABEL[ev.to_status] ?? ev.to_status}</strong>
                  <div className="tiny muted">{fmtDateTime(ev.created_at, tz)} · {ev.actor_type === "system" ? "YOS (automatic)" : ev.actor_type === "staff" ? "YOS support" : "member"}</div>
                  {ev.note && <div className="small">{ev.note}</div>}
                </li>
              ))}
            </ul>
          </section>
          <p className="small"><Link href={`/support/new?exchange=${e.id}`}>Get help with this exchange</Link></p>
        </aside>
      </div>
    </div>
  );
}
