import type { ReactNode } from "react";
import type { ExchangeView } from "@/server/domain/exchanges/queries";
import { cx } from "@/shared/lib/cx";
import { fmtDateTime } from "@/shared/lib/format";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { messageAction } from "../api/actions";

type Message = ExchangeView["messages"][number];

export function MessageThread({
  exchangeId,
  messages,
  viewerId,
  counterpart,
  canWrite,
  messageFooter,
  timeZone,
}: {
  exchangeId: string;
  messages: Message[];
  viewerId: string;
  counterpart: string;
  canWrite: boolean;
  /** Rendered under each message from the other member, e.g. a report control. */
  messageFooter?: (message: Message) => ReactNode;
  timeZone: string;
}) {
  return (
    <section className="card" id="messages">
      <h2>Messages</h2>
      <p className="small muted">
        Keep the conversation about this exchange. Never share payment details or pay outside YOS.
      </p>
      {messages.length > 0 && (
        <div className="messages">
          {messages.map((m) => {
            const mine = m.sender_id === viewerId;
            return (
              <div key={m.id} className={cx("msg", mine && "mine")}>
                <div className="who">
                  {mine ? "You" : m.sender_name} · {fmtDateTime(m.created_at, timeZone)}
                </div>
                {m.body}
                {!mine && messageFooter?.(m)}
              </div>
            );
          })}
        </div>
      )}
      {canWrite && (
        <ActionForm action={messageAction.bind(null, exchangeId)} resetOnSuccess className="stack-sm">
          <label htmlFor="body" className="sr-only">
            Message
          </label>
          <textarea id="body" name="body" rows={3} required maxLength={2000} placeholder={`Message ${counterpart}…`} />
          <SubmitButton className="btn btn-sm">Send</SubmitButton>
        </ActionForm>
      )}
    </section>
  );
}
