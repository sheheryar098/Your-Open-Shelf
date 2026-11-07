import { pool, queryOne, tx, isUniqueViolation, type Db } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { policy } from "@/server/config";
import { addDays, now } from "@/server/clock";
import { countryName } from "@/shared/lib/countries";
import { reserveForExchange } from "../credits";
import { checkEligibility } from "../routes";
import { notify } from "../notifications";
import type { Listing } from "../listings";
import { bookTitle, recordEvent } from "./core";

export interface RequestInput {
  requesterId: string;
  listingId: string;
  addressId: string;
  /** Idempotency key rendered into the request form; repeat submits return the same exchange. */
  requestKey: string;
}

const requestFingerprint = (i: RequestInput) => `${i.requesterId}:${i.listingId}:${i.addressId}`;

/**
 * Idempotent replay: the same key and the same request returns the original
 * exchange; the same key with a different request is refused rather than silently answered.
 */
async function priorRequest(db: Db, input: RequestInput): Promise<string | null> {
  const prior = await queryOne<{ id: string; request_fingerprint: string }>(
    "SELECT id, request_fingerprint FROM exchanges WHERE request_key = $1",
    [input.requestKey],
    db,
  );
  if (!prior) return null;
  if (prior.request_fingerprint !== requestFingerprint(input)) {
    throw new DomainError(
      "This request form was already used for a different request. Please reload the page.",
      "idempotency_mismatch",
    );
  }
  return prior.id;
}

export async function requestBook(input: RequestInput): Promise<string> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.requestKey))
    throw new DomainError("Invalid request. Please reload the page.");
  try {
    return await tx(async (c) => {
      const prior = await priorRequest(c, input);
      if (prior) return prior;

      const requester = (
        await c.query<{
          status: string;
          email_verified_at: Date | null;
          can_request: boolean;
          country_code: string | null;
        }>("SELECT status, email_verified_at, can_request, country_code FROM users WHERE id = $1", [input.requesterId])
      ).rows[0];
      if (!requester || requester.status !== "active") throw new ForbiddenError();
      if (!requester.email_verified_at) throw new DomainError("Verify your email address before requesting books.");
      if (!requester.can_request)
        throw new DomainError("Requesting is currently restricted on your account. Contact support for details.");

      // Lock the copy first so two members can't reserve it at the same time.
      const listing = (await c.query<Listing>("SELECT * FROM listings WHERE id = $1 FOR UPDATE", [input.listingId]))
        .rows[0];
      if (!listing) throw new NotFoundError("Listing");
      if (listing.owner_id === input.requesterId) throw new DomainError("You can't request your own book.");
      if (listing.status !== "active")
        throw new DomainError("Sorry, this book is no longer available to request.", "listing_unavailable");
      const owner = (await c.query<{ status: string }>("SELECT status FROM users WHERE id = $1", [listing.owner_id]))
        .rows[0];
      if (owner?.status !== "active")
        throw new DomainError("Sorry, this book is no longer available to request.", "listing_unavailable");

      const address = (
        await c.query<{
          recipient_name: string;
          line1: string;
          line2: string | null;
          city: string;
          region: string | null;
          postal_code: string | null;
          country_code: string;
          phone: string | null;
        }>("SELECT * FROM addresses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL", [
          input.addressId,
          input.requesterId,
        ])
      ).rows[0];
      if (!address) throw new DomainError("Choose a delivery address.");

      const elig = await checkEligibility(listing, address.country_code, c);
      if (!elig.ok) throw new DomainError(elig.reason, "route_unsupported");
      const route = elig.route;
      if (route.max_weight_grams && listing.weight_grams && listing.weight_grams > route.max_weight_grams) {
        throw new DomainError("This book is over the weight limit for this shipping route.", "route_unsupported");
      }

      const counts = (
        await c.query<{ open: string; done: string }>(
          `SELECT count(*) FILTER (WHERE status IN ('requested','accepted')) AS open,
                count(*) FILTER (WHERE status = 'completed') AS done
             FROM exchanges WHERE requester_id = $1`,
          [input.requesterId],
        )
      ).rows[0];
      const limit = Number(counts.done) > 0 ? policy.openRequestLimit : policy.openRequestLimitNewMember;
      if (Number(counts.open) >= limit) {
        throw new DomainError(
          `You can have up to ${limit} open requests at a time${Number(counts.done) === 0 ? " until your first exchange completes" : ""}.`,
        );
      }

      const t = now();
      const ex = (
        await c.query<{ id: string }>(
          `INSERT INTO exchanges (listing_id, requester_id, sender_id, route_id, origin_country, destination_country, credit_cost,
           status, request_key, request_fingerprint, requested_at, respond_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'requested',$8,$9,$10,$11) RETURNING id`,
          [
            listing.id,
            input.requesterId,
            listing.owner_id,
            route.id,
            listing.origin_country,
            address.country_code,
            listing.credit_cost,
            input.requestKey,
            requestFingerprint(input),
            t,
            addDays(t, policy.senderResponseDays),
          ],
        )
      ).rows[0];
      await c.query(
        `INSERT INTO exchange_addresses (exchange_id, recipient_name, line1, line2, city, region, postal_code, country_code, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          ex.id,
          address.recipient_name,
          address.line1,
          address.line2,
          address.city,
          address.region,
          address.postal_code,
          address.country_code,
          address.phone,
        ],
      );
      // Throws InsufficientCreditsError (rolling everything back) if the balance can't cover it.
      await reserveForExchange(c, input.requesterId, ex.id, listing.credit_cost);
      await c.query("UPDATE listings SET status = 'reserved', updated_at = now() WHERE id = $1", [listing.id]);
      await recordEvent(c, ex.id, null, "requested", { type: "member", id: input.requesterId }, null);
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
      throw new DomainError("Sorry, someone else just requested this book.", "listing_unavailable");
    }
    if (isUniqueViolation(err, "exchanges_request_key_key")) {
      const prior = await priorRequest(pool(), input);
      if (prior) return prior;
    }
    throw err;
  }
}
