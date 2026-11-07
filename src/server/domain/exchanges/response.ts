import { tx } from "@/server/db";
import { DomainError, ForbiddenError } from "@/server/errors";
import { policy } from "@/server/config";
import { addBusinessDays, now } from "@/server/clock";
import { releaseForExchange } from "../credits";
import { checkEligibility } from "../routes";
import { notify } from "../notifications";
import type { Listing } from "../listings";
import { lockExchange, transition, bookTitle, setListingStatus, reopenListing } from "./core";

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
      closed_at: now(),
      cancel_kind: "sender_declined",
      close_reason: reason?.slice(0, 500) || null,
    });
    await releaseForExchange(c, ex.requester_id, ex.id, ex.credit_cost, "Request declined by sender, credit returned");
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

/** Requester cancels before the sender accepts. */
export async function cancelRequest(requesterId: string, exchangeId: string) {
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.requester_id !== requesterId) throw new ForbiddenError();
    if (ex.status !== "requested") {
      throw new DomainError(
        "Requests can only be cancelled before the sender accepts. Contact support if you need help.",
      );
    }
    await transition(c, ex, "cancelled", { type: "member", id: requesterId }, "Cancelled by requester", {
      closed_at: now(),
      cancel_kind: "requester_cancelled",
    });
    await releaseForExchange(c, ex.requester_id, ex.id, ex.credit_cost, "Request cancelled, credit returned");
    await reopenListing(c, ex.listing_id);
    await notify(c, ex.sender_id, {
      type: "request_cancelled",
      title: `A request for “${await bookTitle(c, ex.listing_id)}” was cancelled`,
      body: "Your listing is available again.",
      link: `/exchanges/${ex.id}`,
    });
  });
}

/** Sender can't ship after accepting. Counts against their dispatch record. */
export async function senderCancel(senderId: string, exchangeId: string, reason: string) {
  const why = reason?.trim();
  if (!why || why.length < 5) throw new DomainError("Tell the requester briefly why you can't send the book.");
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.sender_id !== senderId) throw new ForbiddenError();
    if (ex.status !== "accepted")
      throw new DomainError("Only accepted, not-yet-shipped exchanges can be cancelled this way.");
    await transition(c, ex, "cancelled", { type: "member", id: senderId }, why.slice(0, 500), {
      closed_at: now(),
      cancel_kind: "sender_cancelled",
      close_reason: why.slice(0, 500),
    });
    await releaseForExchange(
      c,
      ex.requester_id,
      ex.id,
      ex.credit_cost,
      "Sender cancelled before dispatch, credit returned",
    );
    await setListingStatus(c, ex.listing_id, "paused", "Paused after a cancelled exchange");
    await notify(c, ex.requester_id, {
      type: "request_cancelled",
      title: `The sender cancelled your exchange for “${await bookTitle(c, ex.listing_id)}”`,
      body: `Your credit has been returned. Sender's note: ${why.slice(0, 200)}`,
      link: `/exchanges/${ex.id}`,
    });
  });
}
