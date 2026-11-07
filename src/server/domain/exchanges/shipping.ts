import { tx } from "@/server/db";
import { DomainError, ForbiddenError } from "@/server/errors";
import { policy } from "@/server/config";
import { addDays, now } from "@/server/clock";
import { type ShippingRoute } from "../routes";
import { notify } from "../notifications";
import { saveUpload } from "../files";
import { lockExchange, transition, bookTitle } from "./core";

export interface ShipInput {
  carrier: string;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  dispatchDate: string; // YYYY-MM-DD
  proof?: File | null;
}

export function validateTracking(raw: string): string {
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{8,40}$/.test(t))
    throw new DomainError("That tracking number doesn't look right. Check it against your receipt.");
  if (/^(.)\1+$/.test(t) || /^(0123456789|1234567890)/.test(t))
    throw new DomainError("Please enter the real tracking number from your carrier.");
  return t;
}

export async function markShipped(senderId: string, exchangeId: string, input: ShipInput) {
  const carrier = input.carrier?.trim();
  if (!carrier || carrier.length < 2 || carrier.length > 60)
    throw new DomainError("Enter the carrier or postal service you used.");
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
    if (date.getTime() > addDays(now(), 1).getTime())
      throw new DomainError("The dispatch date can't be in the future.");
    if (ex.accepted_at && date.getTime() < addDays(ex.accepted_at, -2).getTime())
      throw new DomainError("The dispatch date is before you accepted the request.");
    const route = (await c.query<ShippingRoute>("SELECT * FROM shipping_routes WHERE id = $1", [ex.route_id])).rows[0];

    let tracking: string | null = null;
    if (input.trackingNumber?.trim()) {
      tracking = validateTracking(input.trackingNumber);
      const reused = (
        await c.query("SELECT 1 FROM shipments WHERE lower(tracking_number) = lower($1) AND exchange_id <> $2", [
          tracking,
          ex.id,
        ])
      ).rowCount;
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
    // Only tracked parcels auto-confirm. Untracked ones wait for the recipient or support.
    await transition(
      c,
      ex,
      "shipped",
      { type: "member", id: senderId },
      `${carrier}${tracking ? ` · ${tracking}` : " · proof of postage"}`,
      {
        shipped_at: t,
        auto_confirm_at: tracking ? addDays(t, maxDays + policy.autoConfirmGraceDays) : null,
      },
    );
    await notify(c, ex.requester_id, {
      type: "shipped",
      title: `“${await bookTitle(c, ex.listing_id)}” is on its way`,
      body: tracking
        ? `Sent with ${carrier}. Tracking: ${tracking}.`
        : `Sent with ${carrier} (untracked, proof of postage provided).`,
      link: `/exchanges/${ex.id}`,
    });
  });
}
