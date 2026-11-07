import type { PoolClient } from "pg";
import { query, tx } from "@/server/db";
import { addDays } from "@/server/clock";
import { releaseForExchange } from "../credits";
import { notify } from "../notifications";
import type { DueItemJob } from "@/server/jobs/types";
import {
  type Exchange,
  type Actor,
  transition,
  bookTitle,
  setListingStatus,
  reopenListing,
  complete,
  markDelivered,
} from "./core";

// Scheduled exchange transitions.
//
// Each job is split into `find` (identifiers only) and `handle` (one item, one transaction).
// Handlers lock the row with SKIP LOCKED and re-check its state, so running one twice, or
// concurrently on two instances, is harmless: the second call sees nothing to do.
// Notifications and email are written in the same transaction (outbox pattern), so they are
// only visible to the email worker once the state change has committed.
// ---------------------------------------------------------------------------

const SYSTEM: Actor = { type: "system" };

function lockedItem(fn: (c: PoolClient, ex: Exchange, t: Date) => Promise<boolean>) {
  return (id: string, t: Date) =>
    tx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '15s'");
      const ex = (await c.query<Exchange>("SELECT * FROM exchanges WHERE id = $1 FOR UPDATE SKIP LOCKED", [id]))
        .rows[0];
      if (!ex) return false; // locked by a member action right now, or gone: pick it up next run
      return fn(c, ex, t);
    });
}

const ids = async (sql: string, t: Date, limit: number) =>
  (await query<{ id: string }>(sql, [t, limit])).map((r) => r.id);

export const exchangeJobs: Record<string, DueItemJob> = {
  "exchanges.expire-requests": {
    find: (t, limit) =>
      ids(
        "SELECT id FROM exchanges WHERE status = 'requested' AND respond_by <= $1 ORDER BY respond_by LIMIT $2",
        t,
        limit,
      ),
    handle: lockedItem(async (c, ex, t) => {
      if (ex.status !== "requested" || ex.respond_by > t) return false;
      await transition(c, ex, "expired", SYSTEM, "Sender didn't respond in time", {
        closed_at: t,
        cancel_kind: "sender_no_response",
      });
      await releaseForExchange(c, ex.requester_id, ex.id, ex.credit_cost, "Request expired, credit returned");
      await reopenListing(c, ex.listing_id);
      const title = await bookTitle(c, ex.listing_id);
      await notify(c, ex.requester_id, {
        type: "request_declined",
        title: `Your request for “${title}” expired`,
        body: "The sender didn't respond in time. Your credit has been returned.",
        link: `/exchanges/${ex.id}`,
      });
      await notify(c, ex.sender_id, {
        type: "request_cancelled",
        title: `A request for “${title}” expired`,
        body: "You didn't respond within the deadline. Your listing is still active.",
        link: `/exchanges/${ex.id}`,
      });
      return true;
    }),
  },

  "exchanges.cancel-missed-dispatch": {
    find: (t, limit) =>
      ids(
        "SELECT id FROM exchanges WHERE status = 'accepted' AND dispatch_by <= $1 ORDER BY dispatch_by LIMIT $2",
        t,
        limit,
      ),
    handle: lockedItem(async (c, ex, t) => {
      if (ex.status !== "accepted" || !ex.dispatch_by || ex.dispatch_by > t) return false;
      await transition(c, ex, "cancelled", SYSTEM, "Not dispatched by the deadline", {
        closed_at: t,
        cancel_kind: "sender_no_dispatch",
      });
      await releaseForExchange(
        c,
        ex.requester_id,
        ex.id,
        ex.credit_cost,
        "Sender didn't dispatch in time, credit returned",
      );
      await setListingStatus(c, ex.listing_id, "paused", "Paused after a missed dispatch deadline");
      const title = await bookTitle(c, ex.listing_id);
      await notify(c, ex.requester_id, {
        type: "request_cancelled",
        title: `The exchange for “${title}” was cancelled`,
        body: "The sender didn't dispatch in time. Your credit has been returned.",
        link: `/exchanges/${ex.id}`,
      });
      await notify(c, ex.sender_id, {
        type: "request_cancelled",
        title: `The exchange for “${title}” was cancelled`,
        body: "The book wasn't marked as shipped by the dispatch deadline. Your listing has been paused.",
        link: `/exchanges/${ex.id}`,
      });
      return true;
    }),
  },

  "exchanges.auto-confirm-delivery": {
    find: (t, limit) =>
      ids(
        "SELECT id FROM exchanges WHERE status = 'shipped' AND auto_confirm_at <= $1 ORDER BY auto_confirm_at LIMIT $2",
        t,
        limit,
      ),
    handle: lockedItem(async (c, ex, t) => {
      if (ex.status !== "shipped" || !ex.auto_confirm_at || ex.auto_confirm_at > t) return false;
      await markDelivered(c, ex, SYSTEM, "auto", "Delivery window passed for a tracked parcel");
      return true;
    }),
  },

  "exchanges.complete-after-window": {
    find: (t, limit) =>
      ids(
        `SELECT id
           FROM exchanges
          WHERE status = 'delivered' AND completion_due_at <= $1
          ORDER BY completion_due_at
          LIMIT $2`,
        t,
        limit,
      ),
    handle: lockedItem(async (c, ex, t) => {
      if (ex.status !== "delivered" || !ex.completion_due_at || ex.completion_due_at > t) return false;
      await complete(c, ex, SYSTEM, "Dispute window passed with no problems reported");
      return true;
    }),
  },

  "exchanges.respond-reminders": {
    find: (t, limit) =>
      ids(
        `SELECT id FROM exchanges WHERE status = 'requested' AND respond_reminder_at IS NULL
       AND respond_by > $1 AND respond_by <= $1::timestamptz + interval '24 hours'
        ORDER BY respond_by LIMIT $2`,
        t,
        limit,
      ),
    handle: lockedItem(async (c, ex, t) => {
      // Past the deadline the request expires instead; a reminder would only confuse.
      if (ex.status !== "requested" || ex.respond_reminder_at || ex.respond_by <= t) return false;
      await c.query("UPDATE exchanges SET respond_reminder_at = $2 WHERE id = $1", [ex.id, t]);
      await notify(c, ex.sender_id, {
        type: "dispatch_reminder",
        title: `Please respond to the request for “${await bookTitle(c, ex.listing_id)}”`,
        body: "The response deadline is within 24 hours.",
        link: `/exchanges/${ex.id}`,
      });
      return true;
    }),
  },

  "exchanges.dispatch-reminders": {
    find: (t, limit) =>
      ids(
        `SELECT id FROM exchanges WHERE status = 'accepted' AND dispatch_reminder_at IS NULL
       AND dispatch_by > $1 AND dispatch_by <= $1::timestamptz + interval '24 hours'
        ORDER BY dispatch_by LIMIT $2`,
        t,
        limit,
      ),
    handle: lockedItem(async (c, ex, t) => {
      if (ex.status !== "accepted" || ex.dispatch_reminder_at || !ex.dispatch_by || ex.dispatch_by <= t) return false;
      await c.query("UPDATE exchanges SET dispatch_reminder_at = $2 WHERE id = $1", [ex.id, t]);
      await notify(c, ex.sender_id, {
        type: "dispatch_reminder",
        title: `Dispatch deadline approaching for “${await bookTitle(c, ex.listing_id)}”`,
        body: "Please ship the book and add tracking within 24 hours.",
        link: `/exchanges/${ex.id}`,
      });
      return true;
    }),
  },
};

/** Redacts delivery addresses 60 days after an exchange closes. Safe to run repeatedly. */
export async function redactClosedAddresses(t: Date): Promise<number> {
  const rows = await query(
    `UPDATE exchange_addresses a SET recipient_name = '[redacted]', line1 = '[redacted]', line2 = NULL, phone = NULL, redacted_at = $1
       FROM exchanges e WHERE e.id = a.exchange_id AND a.redacted_at IS NULL AND e.closed_at < $2
       AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.exchange_id = e.id AND d.status <> 'resolved')
     RETURNING a.exchange_id`,
    [t, addDays(t, -60)],
  );
  return rows.length;
}
