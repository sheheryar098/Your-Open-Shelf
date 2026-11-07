import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/shared/api/session";
import { getTicketForViewer } from "@/server/domain/support";
import { TICKET_CATEGORIES } from "@/shared/lib/vocab";
import { fmtDateTime, shortId } from "@/shared/lib/format";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { Badge } from "@/shared/ui/primitives";
import { replyTicketAction } from "@/features/support/api/actions";
import { isUuid } from "@/shared/lib/ids";
import { cx } from "@/shared/lib/cx";

export const metadata = { title: "Support ticket" };

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser("/support");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await getTicketForViewer(id, u);
  if (!data) notFound();
  const { ticket: t, messages, staff } = data;
  return (
    <div className="container narrow page stack-lg">
      <p className="small">
        <Link href={staff ? "/admin/support" : "/support"}>← {staff ? "Support queue" : "Your tickets"}</Link>
      </p>
      <div>
        <div className="row">
          <Badge tone="info">{t.status.replace("_", " ")}</Badge>
          {staff && (
            <Badge tone={t.priority === "urgent" || t.priority === "high" ? "danger" : undefined}>
              {t.priority} priority
            </Badge>
          )}
          <span className="small muted">
            #{shortId(t.id)} · {TICKET_CATEGORIES[t.category]}
          </span>
        </div>
        <h1 style={{ marginTop: 8 }}>{t.subject}</h1>
        {staff && (
          <p className="small muted">
            {t.member_name ? (
              <>
                Member: <Link href={`/admin/members/${t.user_id}`}>{t.member_name}</Link>
              </>
            ) : (
              <>Visitor: {t.contact_email}</>
            )}
            {t.exchange_id && (
              <>
                {" "}
                · <Link href={`/admin/exchanges/${t.exchange_id}`}>Related exchange</Link>
              </>
            )}
            {t.assignee_name && <> · Assigned to {t.assignee_name}</>}
          </p>
        )}
        {!staff && t.exchange_id && (
          <p className="small">
            <Link href={`/exchanges/${t.exchange_id}`}>View related exchange</Link>
          </p>
        )}
      </div>
      <div className="card">
        <div className="messages" style={{ maxHeight: "none" }}>
          {messages.map((m) => (
            <div
              key={m.id}
              className={cx(
                "msg",
                m.author_id === u.id && "mine",
                !!m.author_role && m.author_role !== "member" && "staff",
                m.internal && "internal",
              )}
            >
              <div className="who">
                {m.author_id === u.id
                  ? "You"
                  : m.author_role && m.author_role !== "member"
                    ? `${m.author_name} (YOS support)`
                    : (m.author_name ?? t.contact_email)}{" "}
                · {fmtDateTime(m.created_at, u.timezone)}
                {m.internal && " · internal"}
              </div>
              {m.body}
            </div>
          ))}
        </div>
      </div>
      {t.status !== "closed" && (
        <section className="card">
          <ActionForm action={replyTicketAction.bind(null, t.id)} resetOnSuccess>
            <div className="field">
              <label htmlFor="body">Reply</label>
              <textarea id="body" name="body" rows={4} maxLength={5000} required={!staff} />
            </div>
            {staff && (
              <div className="row">
                <label className="check small">
                  <input type="checkbox" name="internal" /> Internal note
                </label>
                <label className="check small">
                  <input type="checkbox" name="assignToMe" /> Assign to me
                </label>
                <select name="status" defaultValue="" aria-label="Status">
                  <option value="">Status: auto</option>
                  {["open", "in_progress", "awaiting_member", "resolved", "closed"].map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </select>
                <select name="priority" defaultValue="" aria-label="Priority">
                  <option value="">Priority: keep</option>
                  {["low", "normal", "high", "urgent"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <SubmitButton>{staff ? "Save" : "Send reply"}</SubmitButton>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
