import { query, queryOne } from "@/server/db";
import { can } from "@/server/rbac";
import { checkEligibility, type ShippingRoute, type ShipSettings } from "../routes";
import { addressesFor } from "../support";
import type { Exchange } from "./core";

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
    where.push(
      `(lower(b.title) LIKE $${params.length} OR lower(ru.display_name) LIKE $${params.length}
        OR lower(su.display_name) LIKE $${params.length} OR e.id::text LIKE $${params.length})`,
    );
  }
  return query<ExchangeSummary>(
    `SELECT ${SUMMARY_SELECT} WHERE ${where.join(" AND ")} ORDER BY e.updated_at DESC LIMIT ${filter.limit ?? 100}`,
    params,
  );
}

export async function getExchangeForViewer(id: string, viewer: { id: string; role: string }) {
  const ex = await queryOne<
    ExchangeSummary & { condition: string; format: string; language: string; condition_notes: string }
  >(
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
    queryOne<{
      carrier: string;
      tracking_number: string | null;
      tracking_url: string | null;
      dispatch_date: string;
      proof_file_id: string | null;
      status: string;
    }>(
      `SELECT carrier, tracking_number, tracking_url, to_char(dispatch_date, 'YYYY-MM-DD') AS dispatch_date, proof_file_id, status
         FROM shipments
        WHERE exchange_id = $1`,
      [id],
    ),
    query<{ from_status: string | null; to_status: string; actor_type: string; note: string | null; created_at: Date }>(
      `SELECT from_status, to_status, actor_type, note, created_at
         FROM exchange_events
        WHERE exchange_id = $1
        ORDER BY id`,
      [id],
    ),
    query<{ id: string; sender_id: string; body: string; created_at: Date; sender_name: string }>(
      `SELECT m.id, m.sender_id, m.body, m.created_at, u.display_name AS sender_name
         FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.exchange_id = $1 AND m.hidden_at IS NULL ORDER BY m.created_at`,
      [id],
    ),
    query<{ id: string; status: string; issue_type: string; outcome: string | null; created_at: Date }>(
      `SELECT id, status, issue_type, outcome, created_at
         FROM disputes
        WHERE exchange_id = $1
        ORDER BY created_at DESC`,
      [id],
    ),
    query<{ reviewer_id: string; rating: number; tags: string[]; comment: string | null }>(
      "SELECT reviewer_id, rating, tags, comment FROM reviews WHERE exchange_id = $1 AND hidden_at IS NULL",
      [id],
    ),
  ]);

  // The sender only sees the full address once they've accepted.
  const addressVisible =
    isRequester ||
    isStaff ||
    (isSender && !["requested", "declined", "expired"].includes(ex.status) && ex.accepted_at !== null);
  const address = await queryOne<{
    recipient_name: string;
    line1: string;
    line2: string | null;
    city: string;
    region: string | null;
    postal_code: string | null;
    country_code: string;
    phone: string | null;
    redacted_at: Date | null;
  }>("SELECT * FROM exchange_addresses WHERE exchange_id = $1", [id]);
  const addressSummary = address
    ? { city: address.city, region: address.region, country_code: address.country_code }
    : null;

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
    id: string;
    exchange_id: string;
    opened_by: string;
    issue_type: string;
    description: string;
    status: string;
    outcome: string | null;
    decision_reason: string | null;
    decided_at: Date | null;
    created_at: Date;
    assigned_to: string | null;
    requester_id: string;
    sender_id: string;
    title: string;
    opener_name: string;
    exchange_status: string;
  }>(
    `SELECT d.*, e.requester_id, e.sender_id, e.status AS exchange_status, b.title, u.display_name AS opener_name
       FROM disputes d JOIN exchanges e ON e.id = d.exchange_id JOIN listings l ON l.id = e.listing_id
       JOIN books b ON b.id = l.book_id JOIN users u ON u.id = d.opened_by WHERE d.id = $1`,
    [id],
  );
  if (!d) return null;
  const staff = can(viewer.role, "disputes.manage");
  if (!staff && d.requester_id !== viewer.id && d.sender_id !== viewer.id) return null;
  const messages = await query<{
    id: string;
    author_id: string;
    author_name: string;
    author_role: string;
    body: string;
    file_id: string | null;
    internal: boolean;
    created_at: Date;
  }>(
    `SELECT m.id, m.author_id, u.display_name AS author_name, u.role AS author_role, m.body, m.file_id, m.internal, m.created_at
       FROM dispute_messages m JOIN users u ON u.id = m.author_id
      WHERE m.dispute_id = $1 AND (NOT m.internal OR $2) ORDER BY m.created_at`,
    [id, staff],
  );
  return { dispute: d, messages, staff };
}

export async function senderPerformance(userId: string) {
  const r = await queryOne<{
    completed: string;
    sender_cancelled: string;
    total_accepted: string;
    avg_dispatch_hours: string | null;
  }>(
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

export type ExchangeView = NonNullable<Awaited<ReturnType<typeof getExchangeForViewer>>>;

/**
 * Everything the "Request this book" panel needs: the member's addresses with route
 * eligibility for each, and the route that would apply. Signed-out visitors get the
 * eligibility for their chosen country instead.
 */
export async function requestOptions(
  listing: ShipSettings,
  viewer: { id: string; country_code: string | null } | null,
  visitorCountry: string | null,
) {
  const addresses = viewer ? await addressesFor(viewer.id) : [];
  const options = await Promise.all(
    addresses.map(async (address) => ({ address, eligibility: await checkEligibility(listing, address.country_code) })),
  );
  const firstEligible = options.find((o) => o.eligibility.ok);
  const country = viewer?.country_code ?? visitorCountry;
  const countryEligibility = country ? await checkEligibility(listing, country) : null;
  const route = firstEligible?.eligibility.ok
    ? firstEligible.eligibility.route
    : countryEligibility?.ok
      ? countryEligibility.route
      : null;
  return {
    options,
    route,
    countryEligibility,
    defaultAddressId:
      options.find((o) => o.eligibility.ok && o.address.is_default)?.address.id ?? firstEligible?.address.id ?? null,
  };
}

export type RequestOptions = Awaited<ReturnType<typeof requestOptions>>;
