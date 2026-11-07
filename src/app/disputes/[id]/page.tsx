import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDisputeForViewer } from "@/domain/exchanges";
import { DISPUTE_TYPES } from "@/lib/vocab";
import { fmtDateTime, shortId } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge } from "@/components/ui";
import { disputeMessageAction, withdrawDisputeAction } from "@/app/actions/exchanges";
import { resolveDisputeAction } from "@/app/actions/admin";

export const metadata = { title: "Dispute" };

const STATUS: Record<string, string> = { open: "Open", awaiting_info: "Waiting for information", under_review: "Under review", resolved: "Resolved" };

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser("/dashboard");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getDisputeForViewer(id, u);
  if (!data) notFound();
  const { dispute: d, messages, staff } = data;
  const resolved = d.status === "resolved";

  return (
    <div className="container narrow page stack-lg">
      <p className="small"><Link href={`/exchanges/${d.exchange_id}`}>← Back to the exchange</Link>{staff && <> · <Link href="/admin/disputes">Dispute queue</Link></>}</p>
      <div>
        <div className="row"><Badge tone={resolved ? "ok" : "danger"}>{STATUS[d.status]}</Badge><span className="small muted">Case #{shortId(d.id)}</span></div>
        <h1 style={{ marginTop: 8 }}>{DISPUTE_TYPES[d.issue_type]}</h1>
        <p className="muted">“{d.title}” · opened by {d.opener_name} on {fmtDateTime(d.created_at, u.timezone)}</p>
      </div>

      {resolved && (
        <div className="callout">
          <p><strong>Decision:</strong>{" "}
            {d.outcome === "release_to_sender" ? "The exchange was completed and the sender received the credit." : d.outcome === "refund_requester" ? "The requester's credit was restored." : "The dispute was withdrawn."}
          </p>
          {d.decision_reason && <p>{d.decision_reason}</p>}
          {d.outcome && <p className="small">Disagree? <Link href={`/support/new?category=general&exchange=${d.exchange_id}`}>Appeal via a support ticket</Link> within 14 days.</p>}
        </div>
      )}

      <section className="card">
        <h2>Case history</h2>
        <div className="messages" style={{ maxHeight: "none" }}>
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.author_id === u.id ? "mine" : ""} ${m.author_role !== "member" ? "staff" : ""} ${m.internal ? "internal" : ""}`}>
              <div className="who">
                {m.author_id === u.id ? "You" : m.author_role !== "member" ? `${m.author_name} (YOS support)` : m.author_name} · {fmtDateTime(m.created_at, u.timezone)}
                {m.internal && " · internal note"}
              </div>
              {m.body}
              {m.file_id && <div style={{ marginTop: 6 }}><a href={`/files/${m.file_id}`} target="_blank" rel="noreferrer">View attached evidence</a></div>}
            </div>
          ))}
        </div>
      </section>

      {!resolved && (
        <section className="card">
          <h2>{staff ? "Add to the case" : "Add information or evidence"}</h2>
          <ActionForm action={disputeMessageAction.bind(null, d.id)} encType="multipart/form-data" resetOnSuccess>
            <div className="field"><label htmlFor="body">Message</label><textarea id="body" name="body" required rows={4} maxLength={4000} /></div>
            <div className="field"><label htmlFor="file">Evidence (optional)</label><input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /></div>
            {staff && (
              <div className="row">
                <label className="check small"><input type="checkbox" name="internal" /> Internal note (staff only)</label>
                <select name="status" defaultValue="" aria-label="Case status">
                  <option value="">Keep status</option>
                  <option value="awaiting_info">Request more information</option>
                  <option value="under_review">Under review</option>
                </select>
              </div>
            )}
            <SubmitButton>Add to case</SubmitButton>
          </ActionForm>
        </section>
      )}

      {!resolved && d.opened_by === u.id && (
        <ActionForm action={withdrawDisputeAction.bind(null, d.id)} confirm="Withdraw this dispute? The exchange will continue as normal." className="inline-form">
          <SubmitButton className="btn btn-sm">Withdraw dispute</SubmitButton>
        </ActionForm>
      )}

      {staff && !resolved && d.exchange_status === "disputed" && (
        <section className="card" style={{ borderColor: "var(--warm)" }}>
          <h2>Decision</h2>
          <p className="small">Review the listing, messages, tracking and evidence. The decision and reason are shown to both members and recorded in the audit log.</p>
          <ActionForm action={resolveDisputeAction.bind(null, d.id)} confirm="Record this decision? Credits will move immediately.">
            <div className="radio-cards">
              <label><input type="radio" name="outcome" value="release_to_sender" required /> <span><strong>Release to sender</strong><br /><span className="small muted">Complete the exchange; sender earns the credit.</span></span></label>
              <label><input type="radio" name="outcome" value="refund_requester" /> <span><strong>Restore requester&apos;s credit</strong><br /><span className="small muted">Close the exchange without a sender credit.</span></span></label>
            </div>
            <div className="field"><label htmlFor="reason">Reason (shown to both members)</label><textarea id="reason" name="reason" required minLength={10} rows={3} /></div>
            <SubmitButton className="btn btn-warm">Record decision</SubmitButton>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
