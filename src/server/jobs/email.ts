import { query, tx } from "@/server/db";
import type { DueItemJob } from "./types";

/** Thrown by a transport. `retriable: false` sends the message straight to the dead state. */
export class EmailSendError extends Error {
  constructor(message: string, public retriable: boolean) {
    super(message);
  }
}

export interface EmailTransport {
  /** `idempotencyKey` lets the provider dedupe if we crash between sending and recording it. */
  send(msg: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<{ messageId: string }>;
}

/** Development transport: logs instead of sending. Replace with a transactional email provider. */
export const consoleTransport: EmailTransport = {
  async send(msg) {
    if (!process.env.VITEST) console.info(JSON.stringify({ event: "email.send", to: msg.to, subject: msg.subject, key: msg.idempotencyKey }));
    return { messageId: `console-${msg.idempotencyKey}` };
  },
};

let transport: EmailTransport = consoleTransport;
export function setEmailTransport(t: EmailTransport) {
  transport = t;
}

export const EMAIL_MAX_ATTEMPTS = 6;

/** Exponential backoff with full jitter: ~30s, 1m, 2m, 4m, 8m… capped at 1h. */
export function emailBackoffMs(attempt: number, random = Math.random): number {
  const ceiling = Math.min(30_000 * 2 ** (attempt - 1), 3_600_000);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

function deliveryJob(lane: "priority" | "standard"): DueItemJob {
  const laneSql = lane === "priority" ? "priority = 0" : "priority > 0";
  return {
    find: async (t, limit) =>
      (await query<{ id: string }>(
        `SELECT id FROM email_outbox WHERE status = 'queued' AND ${laneSql} AND next_attempt_at < $1::timestamptz + interval '1 millisecond'
         ORDER BY priority, next_attempt_at LIMIT $2`,
        [t, limit],
      )).map((r) => r.id),
    handle: (id, t) =>
      tx(async (c) => {
        const m = (await c.query<{ to_email: string; subject: string; body_text: string; attempts: number; status: string }>(
          "SELECT to_email, subject, body_text, attempts, status FROM email_outbox WHERE id = $1 FOR UPDATE SKIP LOCKED",
          [id],
        )).rows[0];
        if (!m || m.status !== "queued") return false; // already sent by another worker
        const attempt = m.attempts + 1;
        try {
          const r = await transport.send({ to: m.to_email, subject: m.subject, text: m.body_text, idempotencyKey: `email:${id}` });
          await c.query(
            "UPDATE email_outbox SET status = 'sent', sent_at = $2, attempts = $3, provider_message_id = $4, last_error = NULL WHERE id = $1",
            [id, t, attempt, r.messageId],
          );
        } catch (err) {
          const retriable = !(err instanceof EmailSendError) || err.retriable;
          const dead = !retriable || attempt >= EMAIL_MAX_ATTEMPTS;
          await c.query(
            `UPDATE email_outbox SET attempts = $2, last_error = $3, status = $4, next_attempt_at = $5 WHERE id = $1`,
            [id, attempt, String((err as Error).message).slice(0, 500), dead ? "dead" : "queued", new Date(t.getTime() + emailBackoffMs(attempt))],
          );
          console.warn(JSON.stringify({ event: "email.failed", id, attempt, dead, error: String((err as Error).message) }));
        }
        return true;
      }),
  };
}

export const emailJobs: Record<string, DueItemJob> = {
  "email.deliver-priority": deliveryJob("priority"),
  "email.deliver": deliveryJob("standard"),
};
