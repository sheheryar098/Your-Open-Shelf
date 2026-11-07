import type { PoolClient } from "pg";
import { queryOne, type Db } from "@/server/db";
import { DomainError, NotFoundError } from "@/server/errors";
import { policy } from "@/server/config";
import { addDays, now } from "@/server/clock";
import { settleExchange } from "../credits";
import { notify } from "../notifications";
import type { Listing } from "../listings";

export type ExchangeStatus =
  | "requested"
  | "accepted"
  | "shipped"
  | "delivered"
  | "completed"
  | "declined"
  | "expired"
  | "cancelled"
  | "disputed"
  | "refunded";

export const LIVE_STATUSES: ExchangeStatus[] = ["requested", "accepted", "shipped", "delivered", "disputed"];

/** Allowed status transitions. Anything not listed is rejected. */
const TRANSITIONS: Record<ExchangeStatus, ExchangeStatus[]> = {
  requested: ["accepted", "declined", "expired", "cancelled"],
  accepted: ["shipped", "cancelled"],
  shipped: ["delivered", "completed", "disputed"],
  delivered: ["completed", "disputed"],
  disputed: ["completed", "refunded", "shipped", "delivered"],
  completed: [],
  declined: [],
  expired: [],
  cancelled: [],
  refunded: [],
};

export interface Exchange {
  id: string;
  listing_id: string;
  requester_id: string;
  sender_id: string;
  route_id: string;
  origin_country: string;
  destination_country: string;
  credit_cost: number;
  status: ExchangeStatus;
  request_key: string;
  requested_at: Date;
  respond_by: Date;
  accepted_at: Date | null;
  dispatch_by: Date | null;
  shipped_at: Date | null;
  auto_confirm_at: Date | null;
  delivered_at: Date | null;
  delivery_confirmed_by: string | null;
  completion_due_at: Date | null;
  completed_at: Date | null;
  closed_at: Date | null;
  close_reason: string | null;
  cancel_kind: string | null;
  status_before_dispute: ExchangeStatus | null;
  respond_reminder_at: Date | null;
  dispatch_reminder_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type Actor = { type: "member" | "system" | "staff"; id?: string | null };

export async function lockExchange(c: PoolClient, id: string): Promise<Exchange> {
  const ex = (await c.query<Exchange>("SELECT * FROM exchanges WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!ex) throw new NotFoundError("Exchange");
  return ex;
}

export async function transition(
  c: PoolClient,
  ex: Exchange,
  to: ExchangeStatus,
  actor: Actor,
  note: string | null,
  patch: Record<string, unknown> = {},
) {
  if (!TRANSITIONS[ex.status].includes(to)) {
    throw new DomainError(`This exchange can't move from “${ex.status}” to “${to}”.`, "invalid_transition");
  }
  const cols = Object.keys(patch);
  const sets = ["status = $2", "updated_at = now()", ...cols.map((k, i) => `${k} = $${i + 3}`)];
  await c.query(`UPDATE exchanges SET ${sets.join(", ")} WHERE id = $1`, [ex.id, to, ...cols.map((k) => patch[k])]);
  await recordEvent(c, ex.id, ex.status, to, actor, note);
  ex.status = to;
}

/** Appends to the exchange timeline. `from` is null for the event that creates the exchange. */
export async function recordEvent(
  c: PoolClient,
  exchangeId: string,
  from: ExchangeStatus | null,
  to: ExchangeStatus,
  actor: Actor,
  note: string | null,
) {
  await c.query(
    `INSERT INTO exchange_events (exchange_id, from_status, to_status, actor_type, actor_id, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [exchangeId, from, to, actor.type, actor.id ?? null, note, now()],
  );
}

export async function bookTitle(c: Db, listingId: string): Promise<string> {
  const r = await queryOne<{ title: string }>(
    "SELECT b.title FROM listings l JOIN books b ON b.id = l.book_id WHERE l.id = $1",
    [listingId],
    c,
  );
  return r?.title ?? "your book";
}

export async function setListingStatus(
  c: PoolClient,
  listingId: string,
  status: Listing["status"],
  reason: string | null = null,
) {
  // A listing taken under review by moderators stays under review.
  await c.query(
    `UPDATE listings SET status = CASE WHEN status = 'under_review' THEN status ELSE $2 END, status_reason = $3, updated_at = now()
      WHERE id = $1`,
    [listingId, status, reason],
  );
}

/** Puts a listing back on the shelf after a request ends without shipment. */
export async function reopenListing(c: PoolClient, listingId: string) {
  await c.query(
    `UPDATE listings SET status = 'active', status_reason = NULL, updated_at = now()
      WHERE id = $1 AND status = 'reserved'`,
    [listingId],
  );
}

export async function complete(
  c: PoolClient,
  ex: Exchange,
  actor: Actor,
  note: string,
  patch: Record<string, unknown> = {},
) {
  await transition(c, ex, "completed", actor, note, { completed_at: now(), closed_at: now(), ...patch });
  await settleExchange(c, ex, {
    type: actor.type === "staff" ? "admin" : "system",
    id: actor.type === "staff" ? actor.id : null,
  });
  await setListingStatus(c, ex.listing_id, "exchanged");
  const title = await bookTitle(c, ex.listing_id);
  await notify(c, ex.sender_id, {
    type: "credit",
    title: `You earned ${ex.credit_cost} credit for sending “${title}”`,
    body: "Thanks for passing it on. Use your credit to request your next read.",
    link: `/exchanges/${ex.id}`,
  });
  await notify(c, ex.requester_id, {
    type: "delivered",
    title: `Exchange for “${title}” completed`,
    body: "You can now leave feedback for the sender.",
    link: `/exchanges/${ex.id}`,
  });
}

export async function markDelivered(
  c: PoolClient,
  ex: Exchange,
  actor: Actor,
  source: "carrier" | "support" | "auto",
  note: string,
) {
  const t = now();
  const due = addDays(t, policy.disputeWindowDays);
  await transition(c, ex, "delivered", actor, note, {
    delivered_at: t,
    delivery_confirmed_by: source,
    completion_due_at: due,
  });
  await c.query("UPDATE shipments SET status = 'delivered', updated_at = now() WHERE exchange_id = $1", [ex.id]);
  await notify(c, ex.requester_id, {
    type: "delivered",
    title: `“${await bookTitle(c, ex.listing_id)}” has been marked as delivered`,
    body: `If there's a problem, report it within ${policy.disputeWindowDays} days. Otherwise the exchange completes automatically.`,
    link: `/exchanges/${ex.id}`,
  });
}
