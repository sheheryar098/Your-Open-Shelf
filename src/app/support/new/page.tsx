import { requireUser } from "@/shared/api/session";
import { exchangesFor } from "@/server/domain/exchanges";
import { TICKET_CATEGORIES } from "@/shared/lib/vocab";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { createTicketAction } from "@/features/support/api/actions";

export const metadata = { title: "New support ticket" };

export default async function NewTicket({ searchParams }: { searchParams: Promise<{ category?: string; exchange?: string }> }) {
  const u = await requireUser("/support/new");
  const sp = await searchParams;
  const [asRequester, asSender] = await Promise.all([exchangesFor(u.id, "requester"), exchangesFor(u.id, "sender")]);
  const exchanges = [...asRequester, ...asSender].sort((a, b) => +new Date(b.requested_at) - +new Date(a.requested_at)).slice(0, 30);
  return (
    <div className="container tight page">
      <h1>Contact support</h1>
      <p className="muted small">For a damaged, lost or misdescribed book, open a dispute from the exchange page instead — it pauses the exchange while we review.</p>
      <ActionForm action={createTicketAction}>
        <div className="field">
          <label htmlFor="category">Topic</label>
          <select id="category" name="category" defaultValue={sp.category && sp.category in TICKET_CATEGORIES ? sp.category : "general"}>
            {Object.entries(TICKET_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="exchangeId">Related exchange (optional)</label>
          <select id="exchangeId" name="exchangeId" defaultValue={sp.exchange ?? ""}>
            <option value="">None</option>
            {exchanges.map((e) => <option key={e.id} value={e.id}>{e.title} — {e.requester_id === u.id ? `from ${e.sender_name}` : `to ${e.requester_name}`}</option>)}
          </select>
        </div>
        <div className="field"><label htmlFor="subject">Subject</label><input id="subject" name="subject" type="text" required maxLength={200} /></div>
        <div className="field"><label htmlFor="body">How can we help?</label><textarea id="body" name="body" required rows={6} maxLength={5000} /></div>
        <p className="tiny muted">Please don&apos;t include passwords or payment card details.</p>
        <SubmitButton>Send</SubmitButton>
      </ActionForm>
    </div>
  );
}
