import { query, queryOne, type Db } from "@/server/db";
import { appUrl } from "@/server/config";

/**
 * Notification types. Essential types (transactions, security) are always delivered;
 * the rest respect the member's preferences.
 */
export const NOTIFICATION_TYPES = {
  request_new: { label: "New request for your book", essential: true },
  request_accepted: { label: "Your request was accepted", essential: true },
  request_declined: { label: "Your request was declined or expired", essential: true },
  request_cancelled: { label: "A request was cancelled", essential: true },
  dispatch_reminder: { label: "Dispatch / response deadline reminders", essential: false },
  shipped: { label: "Book marked as shipped", essential: true },
  delivered: { label: "Delivery confirmation", essential: true },
  credit: { label: "Credit earned or returned", essential: true },
  dispute: { label: "Dispute updates", essential: true },
  message: { label: "New exchange message", essential: false },
  wishlist_match: { label: "Wish-list matches", essential: false },
  listing: { label: "Listing reminders and moderation", essential: true },
  support: { label: "Support ticket updates", essential: true },
  security: { label: "Security and account changes", essential: true },
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Also send an email (default true for essential types). */
  email?: boolean;
}

type Prefs = Record<string, { inSite?: boolean; email?: boolean }>;

export async function notify(db: Db, userId: string, n: NotifyInput) {
  const user = await queryOne<{ email: string; display_name: string; status: string; notification_prefs: Prefs }>(
    "SELECT email, display_name, status, notification_prefs FROM users WHERE id = $1",
    [userId],
    db,
  );
  if (!user || user.status === "closed") return;
  const meta = NOTIFICATION_TYPES[n.type];
  const pref = user.notification_prefs?.[n.type] ?? {};
  const inSite = meta.essential || pref.inSite !== false;
  const wantsEmail = meta.essential ? n.email !== false : pref.email === true && n.email !== false;

  if (inSite) {
    await query(
      "INSERT INTO notifications (user_id, type, title, body, link) VALUES ($1, $2, $3, $4, $5)",
      [userId, n.type, n.title, n.body ?? null, n.link ?? null],
      db,
    );
  }
  if (wantsEmail) {
    const link = n.link ? `\n\n${appUrl()}${n.link}` : "";
    const priority =
      n.type === "security"
        ? EmailPriority.security
        : meta.essential
          ? EmailPriority.transactional
          : EmailPriority.optional;
    await queueEmail(
      db,
      user.email,
      n.title,
      `Hi ${user.display_name},\n\n${n.body ?? n.title}${link}\n\nThe YOS team`,
      priority,
    );
  }
}

/** Email priority lanes, so security mail never waits behind bulk mail. */
export const EmailPriority = { security: 0, transactional: 1, optional: 2 } as const;

/**
 * Adds an email to the outbox. Call it inside the same transaction as the state change it
 * describes (outbox pattern): the worker only ever sees committed rows.
 */
export async function queueEmail(
  db: Db,
  to: string,
  subject: string,
  body: string,
  priority: number = EmailPriority.transactional,
) {
  await query(
    "INSERT INTO email_outbox (to_email, subject, body_text, priority) VALUES ($1, $2, $3, $4)",
    [to, subject, body, priority],
    db,
  );
}

export async function markAllRead(userId: string) {
  await query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [userId]);
}

export async function unreadCount(userId: string): Promise<number> {
  const r = await queryOne<{ n: string }>(
    "SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL",
    [userId],
  );
  return Number(r?.n ?? 0);
}
