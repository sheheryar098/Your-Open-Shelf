import type { PoolClient } from "pg";
import { pool, query, queryOne, tx, isUniqueViolation, type Db } from "@/lib/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { policy } from "@/lib/config";
import { addBusinessDays, addDays, addHours, now } from "@/lib/clock";
import { can } from "@/lib/rbac";
import { countryName } from "@/lib/countries";
import { DISPUTE_TYPES } from "@/lib/vocab";
import { releaseForExchange, refundForExchange, reserveForExchange, settleExchange } from "./credits";
import { checkEligibility, type ShippingRoute } from "./routes";
import { notify } from "./notifications";
import { audit, requireReason } from "./audit";
import { saveUpload } from "./files";
import type { Listing } from "./listings";

export type ExchangeStatus =
  | "requested" | "accepted" | "shipped" | "delivered" | "completed"
  | "declined" | "expired" | "cancelled" | "disputed" | "refunded";

export const LIVE_STATUSES: ExchangeStatus[] = ["requested", "accepted", "shipped", "delivered", "disputed"];

/** Server-side transition table (§10.6). Anything not listed is rejected. */
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
  created_at: Date;
  updated_at: Date;
}

type Actor = { type: "member" | "system" | "staff"; id?: string | null };

async function lockExchange(c: PoolClient, id: string): Promise<Exchange> {
  const ex = (await c.query<Exchange>("SELECT * FROM exchanges WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!ex) throw new NotFoundError("Exchange");
  return ex;
}

async function transition(
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
  await c.query(
    "INSERT INTO exchange_events (exchange_id, from_status, to_status, actor_type, actor_id, note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [ex.id, ex.status, to, actor.type, actor.id ?? null, note, now()],
  );
  ex.status = to;
}

async function bookTitle(c: Db, listingId: string): Promise<string> {
  const r = await queryOne<{ title: string }>(
    "SELECT b.title FROM listings l JOIN books b ON b.id = l.book_id WHERE l.id = $1",
    [listingId],
    c,
  );
  return r?.title ?? "your book";
}

async function setListingStatus(c: PoolClient, listingId: string, status: Listing["status"], reason: string | null = null) {
  // A listing taken under review by moderators stays under review.
  await c.query(
    "UPDATE listings SET status = CASE WHEN status = 'under_review' THEN status ELSE $2 END, status_reason = $3, updated_at = now() WHERE id = $1",
    [listingId, status, reason],
  );
}

/** Puts a listing back on the shelf after a request ends without shipment. */
async function reopenListing(c: PoolClient, listingId: string) {
  await c.query(
    "UPDATE listings SET status = 'active', status_reason = NULL, updated_at = now() WHERE id = $1 AND status = 'reserved'",
    [listingId],
  );
}

// ---------------------------------------------------------------------------
// 1. Request (§9.4)
// ---------------------------------------------------------------------------

export interface RequestInput {
  requesterId: string;
  listingId: string;
  addressId: string;
  /** Idempotency key rendered into the request form; repeat submits return the same exchange. */
  requestKey: string;
}

export async function requestBook(input: RequestInput): Promise<string> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.requestKey)) throw new DomainError("Invalid request. Please reload the page.");
  try {
    return await tx(async (c) => {
      const prior = (await c.query<{ id: string; requester_id: string }>(
        "SELECT id, requester_id FROM exchanges WHERE request_key = $1", [input.requestKey])).rows[0];
      if (prior) {
        if (prior.requester_id !== input.requesterId) throw new DomainError("Invalid request. Please reload the page.");
        return prior.id;
      }

      const requester = (await c.query<{
        status: string; email_verified_at: Date | null; can_request: boolean; country_code: string | null;
      }>("SELECT status, email_verified_at, can_request, country_code FROM users WHERE id = $1", [input.requesterId])).rows[0];
      if (!requester || requester.status !== "active") throw new ForbiddenError();
      if (!requester.email_verified_at) throw new DomainError("Verify your email address before requesting books.");
      if (!requester.can_request) throw new DomainError("Requesting is currently restricted on your account. Contact support for details.");

      // Lock the copy first so two members can't reserve it at the same time.
      const listing = (await c.query<Listing>("SELECT * FROM listings WHERE id = $1 FOR UPDATE", [input.listingId])).rows[0];
      if (!listing) throw new NotFoundError("Listing");
      if (listing.owner_id === input.requesterId) throw new DomainError("You can't request your own book.");
      if (listing.status !== "active") throw new DomainError("Sorry — this book is no longer available to request.", "listing_unavailable");
      const owner = (await c.query<{ status: string }>("SELECT status FROM users WHERE id = $1", [listing.owner_id])).rows[0];
      if (owner?.status !== "active") throw new DomainError("Sorry — this book is no longer available to request.", "listing_unavailable");

      const address = (await c.query<{
        recipient_name: string; line1: string; line2: string | null; city: string; region: string | null;
        postal_code: string | null; country_code: string; phone: string | null;
      }>("SELECT * FROM addresses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL", [input.addressId, input.requesterId])).rows[0];
      if (!address) throw new DomainError("Choose a delivery address.");

      const elig = await checkEligibility(listing, address.country_code, c);
      if (!elig.ok) throw new DomainError(elig.reason, "route_unsupported");
      const route = elig.route;
      if (route.max_weight_grams && listing.weight_grams && listing.weight_grams > route.max_weight_grams) {
        throw new DomainError("This book is over the weight limit for this shipping route.", "route_unsupported");
      }

      const counts = (await c.query<{ open: string; done: string }>(
        `SELECT count(*) FILTER (WHERE status IN ('requested','accepted')) AS open,
                count(*) FILTER (WHERE status = 'completed') AS done
         FROM exchanges WHERE requester_id = $1`, [input.requesterId])).rows[0];
      const limit = Number(counts.done) > 0 ? policy.openRequestLimit : policy.openRequestLimitNewMember;
      if (Number(counts.open) >= limit) {
        throw new DomainError(`You can have up to ${limit} open requests at a time${Number(counts.done) === 0 ? " until your first exchange completes" : ""}.`);
      }

      const t = now();
      const ex = (await c.query<{ id: string }>(
        `INSERT INTO exchanges (listing_id, requester_id, sender_id, route_id, origin_country, destination_country, credit_cost,
           status, request_key, requested_at, respond_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'requested',$8,$9,$10) RETURNING id`,
        [listing.id, input.requesterId, listing.owner_id, route.id, listing.origin_country, address.country_code,
          listing.credit_cost, input.requestKey, t, addDays(t, policy.senderResponseDays)],
      )).rows[0];
      await c.query(
        `INSERT INTO exchange_addresses (exchange_id, recipient_name, line1, line2, city, region, postal_code, country_code, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ex.id, address.recipient_name, address.line1, address.line2, address.city, address.region, address.postal_code,
          address.country_code, address.phone],
      );
      // Throws InsufficientCreditsError (rolling everything back) if the balance can't cover it.
      await reserveForExchange(c, input.requesterId, ex.id, listing.credit_cost);
      await c.query("UPDATE listings SET status = 'reserved', updated_at = now() WHERE id = $1", [listing.id]);
      await c.query(
        "INSERT INTO exchange_events (exchange_id, from_status, to_status, actor_type, actor_id, note, created_at) VALUES ($1, NULL, 'requested', 'member', $2, NULL, $3)",
        [ex.id, input.requesterId, t],
      );
      const title = await bookTitle(c, listing.id);
      await notify(c, listing.owner_id, {
        type: "request_new",
        title: `New request for “${title}”`,
        body: `A member in ${countryName(address.country_code)} has requested your book. Please accept or decline within ${policy.senderResponseDays} days.`,
        link: `/exchanges/${ex.id}`,
      });
      return ex.id;
    });
  } catch (err) {
    if (isUniqueViolation(err, "exchanges_one_live_per_listing")) {
      throw new DomainError("Sorry — someone else just requested this book.", "listing_unavailable");
    }
    if (isUniqueViolation(err, "exchanges_request_key_key")) {
      const prior = await queryOne<{ id: string; requester_id: string }>("SELECT id, requester_id FROM exchanges WHERE request_key = $1", [input.requestKey]);
      if (prior?.requester_id === input.requesterId) return prior.id;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 2. Sender response
// ---------------------------------------------------------------------------

export async function acceptRequest(senderId: string, exchangeId: string) {
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.sender_id !== senderId) throw new ForbiddenError();
    if (ex.status !== "requested") throw new DomainError("This request is no longer awaiting your response.");
    if (ex.respond_by <= now()) throw new DomainError("The response deadline has passed for this request.");
    const listing = (await c.query<Listing>("SELECT * FROM listings WHERE id = $1", [ex.listing_id])).rows[0];
    const elig = await checkEligibility(listing, ex.destination_country, c);
    if (!elig.ok) throw new DomainError(`${elig.reason} Please decline this request.`);
    const t = now();
    await transition(c, ex, "accepted", { type: "member", id: senderId }, null, {
      accepted_at: t,
      dispatch_by: addBusinessDays(t, policy.dispatchBusinessDays),
    });
    const title = await bookTitle(c, ex.listing_id);
    await notify(c, ex.requester_id, {
      type: "request_accepted",
      title: `Your request for “${title}” was accepted`,
      body: `The sender will dispatch it within ${policy.dispatchBusinessDays} business days.`,
      link: `/exchanges/${ex.id}`,
    });
  });
}

export async function declineRequest(senderId: string, exchangeId: string, reason: string, noLongerAvailable: boolean) {
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.sender_id !== senderId) throw new ForbiddenError();
    if (ex.status !== "requested") throw new DomainError("This request is no longer awaiting your response.");
    await transition(c, ex, "declined", { type: "member", id: senderId }, reason?.slice(0, 500) || null, {
      closed_at: now(), cancel_kind: "sender_declined", close_reason: reason?.slice(0, 500) || null,
    });
    await releaseForExchange(c, ex.requester_id, ex.id, ex.credit_cost, "Request declined by sender — credit returned");
    if (noLongerAvailable) await setListingStatus(c, ex.listing_id, "unavailable", "Marked unavailable by owner");
    else await reopenListing(c, ex.listing_id);
    const title = await bookTitle(c, ex.listing_id);
    await notify(c, ex.requester_id, {
      type: "request_declined",
      title: `Your request for “${title}” was declined`,
      body: "Your credit has been returned to your wallet.",
      link: `/exchanges/${ex.id}`,
    });
  });
}

/** Requester cancels before the sender accepts (§10.5). */
export async function cancelRequest(requesterId: string, exchangeId: string) {
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.requester_id !== requesterId) throw new ForbiddenError();
    if (ex.status !== "requested") {
      throw new DomainError("Requests can only be cancelled before the sender accepts. Contact support if you need help.");
    }
    await transition(c, ex, "cancelled", { type: "member", id: requesterId }, "Cancelled by requester", {
      closed_at: now(), cancel_kind: "requester_cancelled",
    });
    await releaseForExchange(c, ex.requester_id, ex.id, ex.credit_cost, "Request cancelled — credit returned");
    await reopenListing(c, ex.listing_id);
    await notify(c, ex.sender_id, {
      type: "request_cancelled",
      title: `A request for “${await bookTitle(c, ex.listing_id)}” was cancelled`,
      body: "Your listing is available again.",
      link: `/exchanges/${ex.id}`,
    });
  });
}

/** Sender can't ship after accepting: cancel, return credit, record a performance event (§10.5). */
export async function senderCancel(senderId: string, exchangeId: string, reason: string) {
  const why = reason?.trim();
  if (!why || why.length < 5) throw new DomainError("Tell the requester briefly why you can't send the book.");
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.sender_id !== senderId) throw new ForbiddenError();
    if (ex.status !== "accepted") throw new DomainError("Only accepted, not-yet-shipped exchanges can be cancelled this way.");
    await transition(c, ex, "cancelled", { type: "member", id: senderId }, why.slice(0, 500), {
      closed_at: now(), cancel_kind: "sender_cancelled", close_reason: why.slice(0, 500),
    });
    await releaseForExchange(c, ex.requester_id, ex.id, ex.credit_cost, "Sender cancelled before dispatch — credit returned");
    await setListingStatus(c, ex.listing_id, "paused", "Paused after a cancelled exchange");
    await notify(c, ex.requester_id, {
      type: "request_cancelled",
      title: `The sender cancelled your exchange for “${await bookTitle(c, ex.listing_id)}”`,
      body: `Your credit has been returned. Sender's note: ${why.slice(0, 200)}`,
      link: `/exchanges/${ex.id}`,
    });
  });
}

// ---------------------------------------------------------------------------
// 3. Dispatch (§9.3, §11.2)
// ---------------------------------------------------------------------------

export interface ShipInput {
  carrier: string;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  dispatchDate: string; // YYYY-MM-DD
  proof?: File | null;
}

export function validateTracking(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{8,40}$/.test(t)) throw new DomainError("That tracking number doesn't look right. Check it against your receipt.");
  if (/^(.)\1+$/.test(t) || /^(0123456789|1234567890)/.test(t)) throw new DomainError("Please enter the real tracking number from your carrier.");
  return t;
}

export async function markShipped(senderId: string, exchangeId: string, input: ShipInput) {
  const carrier = input.carrier?.trim();
  if (!carrier || carrier.length < 2 || carrier.length > 60) throw new DomainError("Enter the carrier or postal service you used.");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.dispatchDate) ? new Date(`${input.dispatchDate}T12:00:00Z`) : null;
  if (!date || isNaN(date.getTime())) throw new DomainError("Enter the dispatch date.");
  let trackingUrl: string | null = null;
  if (input.trackingUrl?.trim()) {
    try {
      const u = new URL(input.trackingUrl.trim());
      if (u.protocol !== "https:") throw new Error();
      trackingUrl = u.toString();
    } catch {
      throw new DomainError("Tracking links must be https:// addresses from your carrier.");
    }
  }
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.sender_id !== senderId) throw new ForbiddenError();
    if (ex.status !== "accepted") throw new DomainError("This exchange isn't waiting for dispatch.");
    if (date.getTime() > addDays(now(), 1).getTime()) throw new DomainError("The dispatch date can't be in the future.");
    if (ex.accepted_at && date.getTime() < addDays(ex.accepted_at, -2).getTime()) throw new DomainError("The dispatch date is before you accepted the request.");
    const route = (await c.query<ShippingRoute>("SELECT * FROM shipping_routes WHERE id = $1", [ex.route_id])).rows[0];

    let tracking: string | null = null;
    if (input.trackingNumber?.trim()) {
      tracking = validateTracking(input.trackingNumber);
      const reused = (await c.query("SELECT 1 FROM shipments WHERE lower(tracking_number) = lower($1) AND exchange_id <> $2", [tracking, ex.id])).rowCount;
      if (reused) throw new DomainError("This tracking number has already been used for another exchange.");
    } else if (route.tracking_required) {
      throw new DomainError("This route requires a tracked service. Enter the tracking number.");
    }
    let proofId: string | null = null;
    if (input.proof && input.proof.size > 0) proofId = await saveUpload(c, input.proof, "proof_of_postage", senderId);
    if (!tracking && !proofId) throw new DomainError("Without tracking, upload a photo of your proof of postage.");

    await c.query(
      `INSERT INTO shipments (exchange_id, carrier, tracking_number, tracking_url, dispatch_date, proof_file_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ex.id, carrier, tracking, trackingUrl, input.dispatchDate, proofId],
    );
    const t = now();
    const maxDays = route.max_delivery_days ?? policy.defaultMaxDeliveryDays;
    // Only tracked parcels can be auto-confirmed; untracked ones need recipient or support confirmation (§11.4).
    await transition(c, ex, "shipped", { type: "member", id: senderId }, `${carrier}${tracking ? ` · ${tracking}` : " · proof of postage"}`, {
      shipped_at: t,
      auto_confirm_at: tracking ? addDays(t, maxDays + policy.autoConfirmGraceDays) : null,
    });
    await notify(c, ex.requester_id, {
      type: "shipped",
      title: `“${await bookTitle(c, ex.listing_id)}” is on its way`,
      body: tracking ? `Sent with ${carrier}. Tracking: ${tracking}.` : `Sent with ${carrier} (untracked, proof of postage provided).`,
      link: `/exchanges/${ex.id}`,
    });
  });
}

// ---------------------------------------------------------------------------
// 4. Delivery & completion
// ---------------------------------------------------------------------------

async function complete(c: PoolClient, ex: Exchange, actor: Actor, note: string, patch: Record<string, unknown> = {}) {
  await transition(c, ex, "completed", actor, note, { completed_at: now(), closed_at: now(), ...patch });
  await settleExchange(c, ex, { type: actor.type === "staff" ? "admin" : "system", id: actor.type === "staff" ? actor.id : null });
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

/** Recipient confirms the book arrived as described: completes immediately (they waive the dispute window). */
export async function confirmReceipt(requesterId: string, exchangeId: string) {
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.requester_id !== requesterId) throw new ForbiddenError();
    if (ex.status !== "shipped" && ex.status !== "delivered") throw new DomainError("This exchange isn't awaiting your confirmation.");
    const patch: Record<string, unknown> = {};
    if (ex.status === "shipped") {
      patch.delivered_at = now();
      patch.delivery_confirmed_by = "recipient";
    }
    await complete(c, ex, { type: "member", id: requesterId }, "Recipient confirmed the book arrived as described", patch);
  });
}

/** Staff record carrier-confirmed (or otherwise verified) delivery. Members can't do this (§10.6). */
export async function markDeliveredByStaff(staffId: string, staffRole: string, exchangeId: string, source: "carrier" | "support", reason: string) {
  if (!can(staffRole, "exchanges.intervene")) throw new ForbiddenError();
  const why = requireReason(reason);
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.status !== "shipped") throw new DomainError("Only shipped exchanges can be marked delivered.");
    await markDelivered(c, ex, { type: "staff", id: staffId }, source, why);
    await audit(c, { actorId: staffId, action: "exchange.mark_delivered", targetType: "exchange", targetId: ex.id, reason: why, metadata: { source } });
  });
}

async function markDelivered(c: PoolClient, ex: Exchange, actor: Actor, source: "carrier" | "support" | "auto", note: string) {
  const t = now();
  const due = addDays(t, policy.disputeWindowDays);
  await transition(c, ex, "delivered", actor, note, { delivered_at: t, delivery_confirmed_by: source, completion_due_at: due });
  await c.query("UPDATE shipments SET status = 'delivered', updated_at = now() WHERE exchange_id = $1", [ex.id]);
  await notify(c, ex.requester_id, {
    type: "delivered",
    title: `“${await bookTitle(c, ex.listing_id)}” has been marked as delivered`,
    body: `If there's a problem, report it within ${policy.disputeWindowDays} days. Otherwise the exchange completes automatically.`,
    link: `/exchanges/${ex.id}`,
  });
}

// ---------------------------------------------------------------------------
// 5. Disputes (§12.4)
// ---------------------------------------------------------------------------

export async function openDispute(userId: string, exchangeId: string, input: { issueType: string; description: string; evidence?: File | null }) {
  if (!(input.issueType in DISPUTE_TYPES)) throw new DomainError("Choose what went wrong.");
  const description = input.description?.trim() ?? "";
  if (description.length < 20) throw new DomainError("Describe the problem in a little more detail (at least 20 characters).");
  return tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.requester_id !== userId && ex.sender_id !== userId) throw new ForbiddenError();
    if (ex.status !== "shipped" && ex.status !== "delivered") {
      throw new DomainError(ex.status === "disputed"
        ? "A dispute is already open for this exchange."
        : "Disputes can be opened once a book has shipped. For other problems, contact support.");
    }
    const d = (await c.query<{ id: string }>(
      "INSERT INTO disputes (exchange_id, opened_by, issue_type, description) VALUES ($1, $2, $3, $4) RETURNING id",
      [ex.id, userId, input.issueType, description.slice(0, 4000)],
    )).rows[0];
    let fileId: string | null = null;
    if (input.evidence && input.evidence.size > 0) fileId = await saveUpload(c, input.evidence, "evidence", userId);
    await c.query(
      "INSERT INTO dispute_messages (dispute_id, author_id, body, file_id) VALUES ($1, $2, $3, $4)",
      [d.id, userId, description.slice(0, 4000), fileId],
    );
    // The completion path pauses while the case is reviewed.
    await transition(c, ex, "disputed", { type: "member", id: userId }, DISPUTE_TYPES[input.issueType], {
      status_before_dispute: ex.status,
    });
    const other = userId === ex.requester_id ? ex.sender_id : ex.requester_id;
    await notify(c, other, {
      type: "dispute",
      title: `A problem was reported on the exchange for “${await bookTitle(c, ex.listing_id)}”`,
      body: "YOS support will review the case. You can add information and evidence on the dispute page.",
      link: `/disputes/${d.id}`,
    });
    await notify(c, userId, {
      type: "dispute",
      title: "We've received your report",
      body: "Support will review the listing, tracking, messages and evidence, and may ask both members for more information.",
      link: `/disputes/${d.id}`,
    });
    return d.id;
  });
}

interface DisputeRow {
  id: string;
  exchange_id: string;
  opened_by: string;
  status: string;
}

export async function withdrawDispute(userId: string, disputeId: string) {
  await tx(async (c) => {
    const d = (await c.query<DisputeRow>("SELECT * FROM disputes WHERE id = $1 FOR UPDATE", [disputeId])).rows[0];
    if (!d) throw new NotFoundError("Dispute");
    if (d.opened_by !== userId) throw new ForbiddenError("Only the member who opened the dispute can withdraw it.");
    if (d.status === "resolved") throw new DomainError("This dispute is already resolved.");
    const ex = await lockExchange(c, d.exchange_id);
    const back = ex.status_before_dispute ?? "shipped";
    const t = now();
    const patch: Record<string, unknown> = { status_before_dispute: null };
    if (back === "delivered") patch.completion_due_at = addDays(t, policy.disputeWindowDays);
    if (back === "shipped" && ex.auto_confirm_at && ex.auto_confirm_at < t) patch.auto_confirm_at = addDays(t, 1);
    await transition(c, ex, back, { type: "member", id: userId }, "Dispute withdrawn", patch);
    await c.query(
      "UPDATE disputes SET status = 'resolved', decision_reason = 'Withdrawn by the member who opened it', decided_at = $2, updated_at = now() WHERE id = $1",
      [d.id, t],
    );
    const other = userId === ex.requester_id ? ex.sender_id : ex.requester_id;
    await notify(c, other, { type: "dispute", title: "A dispute on your exchange was withdrawn", link: `/exchanges/${ex.id}` });
  });
}

export async function resolveDispute(
  staffId: string,
  staffRole: string,
  disputeId: string,
  outcome: "release_to_sender" | "refund_requester",
  reason: string,
) {
  if (!can(staffRole, "disputes.manage")) throw new ForbiddenError();
  const why = requireReason(reason, 10);
  await tx(async (c) => {
    const d = (await c.query<DisputeRow>("SELECT * FROM disputes WHERE id = $1 FOR UPDATE", [disputeId])).rows[0];
    if (!d) throw new NotFoundError("Dispute");
    if (d.status === "resolved") throw new DomainError("This dispute is already resolved.");
    const ex = await lockExchange(c, d.exchange_id);
    if (ex.status !== "disputed") throw new DomainError("The exchange isn't in a disputed state.");
    const actor: Actor = { type: "staff", id: staffId };
    if (outcome === "release_to_sender") {
      await complete(c, ex, actor, `Dispute resolved: credit released to sender. ${why}`);
    } else {
      await transition(c, ex, "refunded", actor, `Dispute resolved: credit restored to requester. ${why}`, {
        closed_at: now(), close_reason: why,
      });
      await refundForExchange(c, ex.requester_id, ex.id, ex.credit_cost, `Dispute resolved in your favour — ${why}`, staffId);
      await setListingStatus(c, ex.listing_id, "unavailable", "Closed after a dispute");
    }
    await c.query(
      "UPDATE disputes SET status = 'resolved', outcome = $2, decision_reason = $3, decided_by = $4, decided_at = $5, updated_at = now() WHERE id = $1",
      [d.id, outcome, why, staffId, now()],
    );
    await audit(c, { actorId: staffId, action: "dispute.resolve", targetType: "dispute", targetId: d.id, reason: why, metadata: { outcome, exchangeId: ex.id } });
    const title = await bookTitle(c, ex.listing_id);
    const body = `Decision: ${outcome === "release_to_sender" ? "the exchange is complete and the sender receives the credit" : "the requester's credit has been restored"}. Reason: ${why}\n\nIf you disagree, you can appeal by opening a support ticket within 14 days.`;
    for (const uid of [ex.requester_id, ex.sender_id]) {
      await notify(c, uid, { type: "dispute", title: `Decision on the dispute for “${title}”`, body, link: `/disputes/${d.id}` });
    }
  });
}

export async function addDisputeMessage(
  user: { id: string; role: string },
  disputeId: string,
  body: string,
  opts: { file?: File | null; internal?: boolean; status?: "awaiting_info" | "under_review" | null } = {},
) {
  const text = body?.trim();
  if (!text) throw new DomainError("Write a message.");
  const staff = can(user.role, "disputes.manage");
  await tx(async (c) => {
    const d = (await c.query<DisputeRow & { requester_id: string; sender_id: string }>(
      `SELECT d.*, e.requester_id, e.sender_id FROM disputes d JOIN exchanges e ON e.id = d.exchange_id WHERE d.id = $1 FOR UPDATE OF d`,
      [disputeId])).rows[0];
    if (!d) throw new NotFoundError("Dispute");
    const party = d.requester_id === user.id || d.sender_id === user.id;
    if (!party && !staff) throw new ForbiddenError();
    if (d.status === "resolved") throw new DomainError("This dispute is resolved. Open a support ticket to appeal.");
    let fileId: string | null = null;
    if (opts.file && opts.file.size > 0) fileId = await saveUpload(c, opts.file, "evidence", user.id);
    const internal = staff && !!opts.internal;
    await c.query(
      "INSERT INTO dispute_messages (dispute_id, author_id, body, file_id, internal) VALUES ($1, $2, $3, $4, $5)",
      [d.id, user.id, text.slice(0, 4000), fileId, internal],
    );
    const nextStatus = staff && opts.status ? opts.status : party && d.status === "awaiting_info" ? "under_review" : null;
    if (nextStatus) await c.query("UPDATE disputes SET status = $2, updated_at = now() WHERE id = $1", [d.id, nextStatus]);
    if (staff && !d.status.includes("review") && !opts.status) {
      await c.query("UPDATE disputes SET status = 'under_review', assigned_to = coalesce(assigned_to, $2), updated_at = now() WHERE id = $1 AND status = 'open'", [d.id, user.id]);
    }
    if (!internal) {
      const recipients = staff ? [d.requester_id, d.sender_id] : [d.requester_id, d.sender_id].filter((u) => u !== user.id);
      for (const uid of recipients) {
        await notify(c, uid, {
          type: "dispute",
          title: staff ? (opts.status === "awaiting_info" ? "Support needs more information about your dispute" : "Support replied on your dispute") : "New message on a dispute",
          link: `/disputes/${d.id}`,
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 6. Staff intervention
// ---------------------------------------------------------------------------

export async function staffCancel(staffId: string, staffRole: string, exchangeId: string, reason: string) {
  if (!can(staffRole, "exchanges.intervene")) throw new ForbiddenError();
  const why = requireReason(reason);
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.status !== "requested" && ex.status !== "accepted") {
      throw new DomainError("Only exchanges that haven't shipped can be cancelled. Use the dispute process for shipped books.");
    }
    await transition(c, ex, "cancelled", { type: "staff", id: staffId }, why, { closed_at: now(), cancel_kind: "support_cancelled", close_reason: why });
    await releaseForExchange(c, ex.requester_id, ex.id, ex.credit_cost, "Exchange cancelled by YOS support — credit returned");
    await reopenListing(c, ex.listing_id);
    await audit(c, { actorId: staffId, action: "exchange.cancel", targetType: "exchange", targetId: ex.id, reason: why });
    for (const uid of [ex.requester_id, ex.sender_id]) {
      await notify(c, uid, { type: "request_cancelled", title: "An exchange was cancelled by YOS support", body: `Reason: ${why}`, link: `/exchanges/${ex.id}` });
    }
  });
}

/** Extends a sender deadline (holidays, carrier disruption — §10.4). */
export async function extendDeadline(staffId: string, staffRole: string, exchangeId: string, days: number, reason: string) {
  if (!can(staffRole, "exchanges.intervene")) throw new ForbiddenError();
  const why = requireReason(reason);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new DomainError("Extend by 1–30 days.");
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    const col = ex.status === "requested" ? "respond_by" : ex.status === "accepted" ? "dispatch_by" : ex.status === "shipped" ? "auto_confirm_at" : ex.status === "delivered" ? "completion_due_at" : null;
    if (!col) throw new DomainError("There's no running deadline to extend.");
    await c.query(`UPDATE exchanges SET ${col} = coalesce(${col}, $2) + make_interval(days => $3), updated_at = now() WHERE id = $1`, [ex.id, now(), days]);
    await c.query(
      "INSERT INTO exchange_events (exchange_id, from_status, to_status, actor_type, actor_id, note, created_at) VALUES ($1,$2,$2,'staff',$3,$4,$5)",
      [ex.id, ex.status, staffId, `Deadline extended by ${days} days: ${why}`, now()],
    );
    await audit(c, { actorId: staffId, action: "exchange.extend_deadline", targetType: "exchange", targetId: ex.id, reason: why, metadata: { days, column: col } });
  });
}

// ---------------------------------------------------------------------------
// 7. Messages & reviews
// ---------------------------------------------------------------------------

export async function postMessage(userId: string, exchangeId: string, body: string) {
  const text = body?.trim();
  if (!text) throw new DomainError("Write a message.");
  if (text.length > 2000) throw new DomainError("Messages can be up to 2000 characters.");
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.requester_id !== userId && ex.sender_id !== userId) throw new ForbiddenError();
    if (ex.closed_at && ex.closed_at < addDays(now(), -30)) throw new DomainError("Messaging is closed for this exchange.");
    await c.query("INSERT INTO messages (exchange_id, sender_id, body, created_at) VALUES ($1, $2, $3, $4)", [ex.id, userId, text, now()]);
    const other = userId === ex.requester_id ? ex.sender_id : ex.requester_id;
    await notify(c, other, { type: "message", title: "New message about an exchange", body: text.slice(0, 140), link: `/exchanges/${ex.id}#messages`, email: false });
  });
}

export async function leaveReview(userId: string, exchangeId: string, input: { rating: number; tags: string[]; comment?: string | null }) {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new DomainError("Choose a rating from 1 to 5.");
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.requester_id !== userId && ex.sender_id !== userId) throw new ForbiddenError();
    // Ratings only after a meaningful exchange event (§12.5).
    if (ex.status !== "completed") throw new DomainError("You can leave feedback once the exchange is completed.");
    const reviewee = userId === ex.requester_id ? ex.sender_id : ex.requester_id;
    try {
      await c.query(
        "INSERT INTO reviews (exchange_id, reviewer_id, reviewee_id, rating, tags, comment, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [ex.id, userId, reviewee, input.rating, input.tags.slice(0, 7), input.comment?.trim().slice(0, 1000) || null, now()],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError("You've already left feedback for this exchange.");
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// 8. Scheduled processing: deadlines, auto-confirmation, completion, retention
// ---------------------------------------------------------------------------

async function forEachDue(sql: string, params: unknown[], fn: (c: PoolClient, ex: Exchange) => Promise<void>) {
  const ids = await query<{ id: string }>(sql, params);
  let n = 0;
  for (const { id } of ids) {
    await tx(async (c) => {
      const ex = (await c.query<Exchange>("SELECT * FROM exchanges WHERE id = $1 FOR UPDATE SKIP LOCKED", [id])).rows[0];
      if (!ex) return;
      await fn(c, ex);
      n++;
    });
  }
  return n;
}

export async function processDueExchanges() {
  const t = now();
  const sys: Actor = { type: "system" };
  const result = { expired: 0, dispatchMissed: 0, autoDelivered: 0, completed: 0, reminders: 0, redacted: 0 };

  result.expired = await forEachDue(
    "SELECT id FROM exchanges WHERE status = 'requested' AND respond_by <= $1 LIMIT 500", [t],
    async (c, ex) => {
      if (ex.status !== "requested" || ex.respond_by > t) return;
      await transition(c, ex, "expired", sys, "Sender didn't respond in time", { closed_at: t, cancel_kind: "sender_no_response" });
      await releaseForExchange(c, ex.requester_id, ex.id, ex.credit_cost, "Request expired — credit returned");
      await reopenListing(c, ex.listing_id);
      const title = await bookTitle(c, ex.listing_id);
      await notify(c, ex.requester_id, { type: "request_declined", title: `Your request for “${title}” expired`, body: "The sender didn't respond in time. Your credit has been returned.", link: `/exchanges/${ex.id}` });
      await notify(c, ex.sender_id, { type: "request_cancelled", title: `A request for “${title}” expired`, body: "You didn't respond within the deadline. Your listing is still active.", link: `/exchanges/${ex.id}` });
    },
  );

  result.dispatchMissed = await forEachDue(
    "SELECT id FROM exchanges WHERE status = 'accepted' AND dispatch_by <= $1 LIMIT 500", [t],
    async (c, ex) => {
      if (ex.status !== "accepted" || !ex.dispatch_by || ex.dispatch_by > t) return;
      await transition(c, ex, "cancelled", sys, "Not dispatched by the deadline", { closed_at: t, cancel_kind: "sender_no_dispatch" });
      await releaseForExchange(c, ex.requester_id, ex.id, ex.credit_cost, "Sender didn't dispatch in time — credit returned");
      await setListingStatus(c, ex.listing_id, "paused", "Paused after a missed dispatch deadline");
      const title = await bookTitle(c, ex.listing_id);
      await notify(c, ex.requester_id, { type: "request_cancelled", title: `The exchange for “${title}” was cancelled`, body: "The sender didn't dispatch in time. Your credit has been returned.", link: `/exchanges/${ex.id}` });
      await notify(c, ex.sender_id, { type: "request_cancelled", title: `The exchange for “${title}” was cancelled`, body: "The book wasn't marked as shipped by the dispatch deadline. Your listing has been paused.", link: `/exchanges/${ex.id}` });
    },
  );

  result.autoDelivered = await forEachDue(
    "SELECT id FROM exchanges WHERE status = 'shipped' AND auto_confirm_at <= $1 LIMIT 500", [t],
    async (c, ex) => {
      if (ex.status !== "shipped" || !ex.auto_confirm_at || ex.auto_confirm_at > t) return;
      await markDelivered(c, ex, sys, "auto", "Delivery window passed for a tracked parcel");
    },
  );

  result.completed = await forEachDue(
    "SELECT id FROM exchanges WHERE status = 'delivered' AND completion_due_at <= $1 LIMIT 500", [t],
    async (c, ex) => {
      if (ex.status !== "delivered" || !ex.completion_due_at || ex.completion_due_at > t) return;
      await complete(c, ex, sys, "Dispute window passed with no problems reported");
    },
  );

  // Reminders a day before deadlines (non-essential, respects preferences).
  const soon = addHours(t, 24);
  const respondDue = await query<{ id: string; sender_id: string; listing_id: string }>(
    `UPDATE exchanges SET respond_reminder_at = $1 WHERE status = 'requested' AND respond_by <= $2 AND respond_reminder_at IS NULL
     RETURNING id, sender_id, listing_id`, [t, soon]);
  const dispatchDue = await query<{ id: string; sender_id: string; listing_id: string }>(
    `UPDATE exchanges SET dispatch_reminder_at = $1 WHERE status = 'accepted' AND dispatch_by <= $2 AND dispatch_reminder_at IS NULL
     RETURNING id, sender_id, listing_id`, [t, soon]);
  for (const r of respondDue) {
    await notify(pool(), r.sender_id, { type: "dispatch_reminder", title: `Please respond to the request for “${await bookTitle(pool(), r.listing_id)}”`, body: "The response deadline is within 24 hours.", link: `/exchanges/${r.id}` });
  }
  for (const r of dispatchDue) {
    await notify(pool(), r.sender_id, { type: "dispatch_reminder", title: `Dispatch deadline approaching for “${await bookTitle(pool(), r.listing_id)}”`, body: "Please ship the book and add tracking within 24 hours.", link: `/exchanges/${r.id}` });
  }
  result.reminders = respondDue.length + dispatchDue.length;

  // Retention: redact delivery addresses 60 days after an exchange closes (§18.6).
  const redacted = await query(
    `UPDATE exchange_addresses a SET recipient_name = '[redacted]', line1 = '[redacted]', line2 = NULL, phone = NULL, redacted_at = $1
     FROM exchanges e WHERE e.id = a.exchange_id AND a.redacted_at IS NULL AND e.closed_at < $2
       AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.exchange_id = e.id AND d.status <> 'resolved')
     RETURNING a.exchange_id`,
    [t, addDays(t, -60)],
  );
  result.redacted = redacted.length;
  return result;
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface ExchangeSummary extends Exchange {
  title: string;
  authors: string[];
  photo_id: string | null;
  requester_name: string;
  sender_name: string;
}

const SUMMARY_SELECT = `
  e.*, b.title, b.authors, ru.display_name AS requester_name, su.display_name AS sender_name,
  (SELECT p.file_id FROM listing_photos p WHERE p.listing_id = e.listing_id ORDER BY p.position LIMIT 1) AS photo_id
  FROM exchanges e
  JOIN listings l ON l.id = e.listing_id JOIN books b ON b.id = l.book_id
  JOIN users ru ON ru.id = e.requester_id JOIN users su ON su.id = e.sender_id`;

export async function exchangesFor(userId: string, side: "requester" | "sender") {
  return query<ExchangeSummary>(
    `SELECT ${SUMMARY_SELECT} WHERE e.${side === "requester" ? "requester_id" : "sender_id"} = $1 ORDER BY e.updated_at DESC LIMIT 200`,
    [userId],
  );
}

export async function allExchanges(filter: { status?: string; q?: string; limit?: number }) {
  const params: unknown[] = [];
  const where: string[] = ["true"];
  if (filter.status) {
    params.push(filter.status);
    where.push(`e.status = $${params.length}`);
  }
  if (filter.q) {
    params.push(`%${filter.q.toLowerCase()}%`);
    where.push(`(lower(b.title) LIKE $${params.length} OR lower(ru.display_name) LIKE $${params.length} OR lower(su.display_name) LIKE $${params.length} OR e.id::text LIKE $${params.length})`);
  }
  return query<ExchangeSummary>(`SELECT ${SUMMARY_SELECT} WHERE ${where.join(" AND ")} ORDER BY e.updated_at DESC LIMIT ${filter.limit ?? 100}`, params);
}

export async function getExchangeForViewer(id: string, viewer: { id: string; role: string }) {
  const ex = await queryOne<ExchangeSummary & { condition: string; format: string; language: string; condition_notes: string }>(
    `SELECT ${SUMMARY_SELECT.replace("e.*,", "e.*, l.condition, l.format, l.language, l.condition_notes,")} WHERE e.id = $1`,
    [id],
  );
  if (!ex) return null;
  const isRequester = ex.requester_id === viewer.id;
  const isSender = ex.sender_id === viewer.id;
  const isStaff = can(viewer.role, "exchanges.view");
  if (!isRequester && !isSender && !isStaff) return null;

  const [route, shipment, events, messages, disputes, reviews] = await Promise.all([
    queryOne<ShippingRoute>("SELECT * FROM shipping_routes WHERE id = $1", [ex.route_id]),
    queryOne<{ carrier: string; tracking_number: string | null; tracking_url: string | null; dispatch_date: string; proof_file_id: string | null; status: string }>(
      "SELECT carrier, tracking_number, tracking_url, to_char(dispatch_date, 'YYYY-MM-DD') AS dispatch_date, proof_file_id, status FROM shipments WHERE exchange_id = $1",
      [id],
    ),
    query<{ from_status: string | null; to_status: string; actor_type: string; note: string | null; created_at: Date }>(
      "SELECT from_status, to_status, actor_type, note, created_at FROM exchange_events WHERE exchange_id = $1 ORDER BY id",
      [id],
    ),
    query<{ id: string; sender_id: string; body: string; created_at: Date; sender_name: string }>(
      `SELECT m.id, m.sender_id, m.body, m.created_at, u.display_name AS sender_name
       FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.exchange_id = $1 AND m.hidden_at IS NULL ORDER BY m.created_at`,
      [id],
    ),
    query<{ id: string; status: string; issue_type: string; outcome: string | null; created_at: Date }>(
      "SELECT id, status, issue_type, outcome, created_at FROM disputes WHERE exchange_id = $1 ORDER BY created_at DESC",
      [id],
    ),
    query<{ reviewer_id: string; rating: number; tags: string[]; comment: string | null }>(
      "SELECT reviewer_id, rating, tags, comment FROM reviews WHERE exchange_id = $1 AND hidden_at IS NULL",
      [id],
    ),
  ]);

  // Address privacy (§4.2): the sender sees the full address only after accepting.
  const addressVisible = isRequester || isStaff || (isSender && !["requested", "declined", "expired"].includes(ex.status) && ex.accepted_at !== null);
  const address = await queryOne<{
    recipient_name: string; line1: string; line2: string | null; city: string; region: string | null;
    postal_code: string | null; country_code: string; phone: string | null; redacted_at: Date | null;
  }>("SELECT * FROM exchange_addresses WHERE exchange_id = $1", [id]);
  const addressSummary = address ? { city: address.city, region: address.region, country_code: address.country_code } : null;

  return {
    exchange: ex,
    route,
    shipment,
    events,
    messages,
    disputes,
    reviews,
    address: addressVisible ? address : null,
    addressSummary,
    viewer: { isRequester, isSender, isStaff },
  };
}

export async function getDisputeForViewer(id: string, viewer: { id: string; role: string }) {
  const d = await queryOne<{
    id: string; exchange_id: string; opened_by: string; issue_type: string; description: string; status: string;
    outcome: string | null; decision_reason: string | null; decided_at: Date | null; created_at: Date; assigned_to: string | null;
    requester_id: string; sender_id: string; title: string; opener_name: string; exchange_status: string;
  }>(
    `SELECT d.*, e.requester_id, e.sender_id, e.status AS exchange_status, b.title, u.display_name AS opener_name
     FROM disputes d JOIN exchanges e ON e.id = d.exchange_id JOIN listings l ON l.id = e.listing_id
     JOIN books b ON b.id = l.book_id JOIN users u ON u.id = d.opened_by WHERE d.id = $1`,
    [id],
  );
  if (!d) return null;
  const staff = can(viewer.role, "disputes.manage");
  if (!staff && d.requester_id !== viewer.id && d.sender_id !== viewer.id) return null;
  const messages = await query<{ id: string; author_id: string; author_name: string; author_role: string; body: string; file_id: string | null; internal: boolean; created_at: Date }>(
    `SELECT m.id, m.author_id, u.display_name AS author_name, u.role AS author_role, m.body, m.file_id, m.internal, m.created_at
     FROM dispute_messages m JOIN users u ON u.id = m.author_id
     WHERE m.dispute_id = $1 AND (NOT m.internal OR $2) ORDER BY m.created_at`,
    [id, staff],
  );
  return { dispute: d, messages, staff };
}

export async function senderPerformance(userId: string) {
  const r = await queryOne<{ completed: string; sender_cancelled: string; total_accepted: string; avg_dispatch_hours: string | null }>(
    `SELECT count(*) FILTER (WHERE status = 'completed') AS completed,
            count(*) FILTER (WHERE cancel_kind IN ('sender_cancelled', 'sender_no_dispatch')) AS sender_cancelled,
            count(*) FILTER (WHERE accepted_at IS NOT NULL) AS total_accepted,
            avg(extract(epoch FROM shipped_at - accepted_at) / 3600) FILTER (WHERE shipped_at IS NOT NULL) AS avg_dispatch_hours
     FROM exchanges WHERE sender_id = $1`,
    [userId],
  );
  return {
    completed: Number(r?.completed ?? 0),
    senderCancelled: Number(r?.sender_cancelled ?? 0),
    totalAccepted: Number(r?.total_accepted ?? 0),
    avgDispatchHours: r?.avg_dispatch_hours ? Number(r.avg_dispatch_hours) : null,
  };
}
