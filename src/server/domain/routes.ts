import { pool, query, queryOne, type Db } from "@/server/db";
import { countryName } from "@/shared/lib/countries";
import { audit, requireReason } from "./audit";
import { DomainError } from "@/server/errors";

export interface Country {
  code: string;
  name: string;
  status: "open" | "limited" | "waitlist" | "unavailable";
  currency: string | null;
  status_note: string | null;
  prohibited_items_notice: string | null;
}

export interface ShippingRoute {
  id: string;
  origin_country: string;
  destination_country: string;
  enabled: boolean;
  tracking_available: boolean;
  tracking_required: boolean;
  carrier_guidance: string | null;
  min_delivery_days: number | null;
  max_delivery_days: number | null;
  postage_estimate_min: string | null;
  postage_estimate_max: string | null;
  postage_currency: string | null;
  max_weight_grams: number | null;
  customs_required: boolean;
  customs_notice: string | null;
  restricted_content_notes: string | null;
  risk_level: "low" | "medium" | "high";
  support_notes: string | null;
}

export const TRANSACTING_STATUSES = new Set(["open", "limited"]);

export async function getCountry(code: string, db?: Db) {
  return queryOne<Country>("SELECT * FROM countries WHERE code = $1", [code], db);
}

export async function listCountries(db?: Db) {
  return query<Country>("SELECT * FROM countries ORDER BY name", [], db);
}

export async function getRoute(origin: string, destination: string, db?: Db) {
  return queryOne<ShippingRoute>(
    "SELECT * FROM shipping_routes WHERE origin_country = $1 AND destination_country = $2",
    [origin, destination],
    db,
  );
}

export async function enabledRoutes(db?: Db) {
  return query<ShippingRoute>(
    `SELECT r.* FROM shipping_routes r
     JOIN countries o ON o.code = r.origin_country AND o.status IN ('open', 'limited')
     JOIN countries d ON d.code = r.destination_country AND d.status IN ('open', 'limited')
     WHERE r.enabled ORDER BY r.origin_country, r.destination_country`,
    [],
    db,
  );
}

export type Eligibility =
  | { ok: true; route: ShippingRoute }
  | { ok: false; reason: string };

export interface ShipSettings {
  origin_country: string;
  ship_scope: "domestic" | "international";
  ship_countries: string[];
}

/**
 * Can a listing shipped from `listing.origin_country` be requested for delivery to
 * `destination`? Combines country status, the admin route matrix, and the sender's own
 * shipping preferences (§4.3, Appendix A: "Unsupported routes cannot complete a request").
 */
export async function checkEligibility(listing: ShipSettings, destination: string, db?: Db): Promise<Eligibility> {
  const origin = listing.origin_country;
  const [o, d] = await Promise.all([getCountry(origin, db), getCountry(destination, db)]);
  if (!o || !TRANSACTING_STATUSES.has(o.status)) {
    return { ok: false, reason: `Exchanges from ${countryName(origin)} aren't available yet.` };
  }
  if (!d || !TRANSACTING_STATUSES.has(d.status)) {
    return { ok: false, reason: `YOS doesn't support deliveries to ${countryName(destination)} yet.` };
  }
  if (origin !== destination) {
    if (listing.ship_scope === "domestic") {
      return { ok: false, reason: `This member only ships within ${countryName(origin)}.` };
    }
    if (listing.ship_countries.length > 0 && !listing.ship_countries.includes(destination)) {
      return { ok: false, reason: `This member doesn't ship to ${countryName(destination)}.` };
    }
  }
  const route = await getRoute(origin, destination, db);
  if (!route || !route.enabled) {
    return {
      ok: false,
      reason: origin === destination
        ? `Exchanges within ${countryName(origin)} aren't enabled yet.`
        : `The ${countryName(origin)} → ${countryName(destination)} route isn't supported yet.`,
    };
  }
  return { ok: true, route };
}

/** Destinations a listing can actually reach, for display on the book page. */
export async function reachableDestinations(listing: ShipSettings, db?: Db): Promise<string[]> {
  const rows = await query<{ destination_country: string }>(
    `SELECT r.destination_country FROM shipping_routes r
     JOIN countries d ON d.code = r.destination_country AND d.status IN ('open', 'limited')
     JOIN countries o ON o.code = r.origin_country AND o.status IN ('open', 'limited')
     WHERE r.enabled AND r.origin_country = $1`,
    [listing.origin_country],
    db,
  );
  return rows
    .map((r) => r.destination_country)
    .filter((dest) => {
      if (dest === listing.origin_country) return true;
      if (listing.ship_scope === "domestic") return false;
      return listing.ship_countries.length === 0 || listing.ship_countries.includes(dest);
    });
}

// ---------------------------------------------------------------------------
// Admin management (§16.5)
// ---------------------------------------------------------------------------

export async function updateCountry(
  adminId: string,
  code: string,
  patch: { status: Country["status"]; status_note?: string | null; prohibited_items_notice?: string | null; currency?: string | null },
  reason: string,
) {
  const why = requireReason(reason);
  const prev = await getCountry(code);
  if (!prev) throw new DomainError("Unknown country.");
  await query(
    `UPDATE countries SET status = $2, status_note = $3, prohibited_items_notice = $4, currency = coalesce($5, currency), updated_at = now()
     WHERE code = $1`,
    [code, patch.status, patch.status_note ?? null, patch.prohibited_items_notice ?? null, patch.currency ?? null],
  );
  await audit(pool(), {
    actorId: adminId, action: "country.update", targetType: "country", targetId: code, reason: why,
    metadata: { from: prev.status, to: patch.status },
  });
}

export type RouteInput = Omit<ShippingRoute, "id">;

export async function upsertRoute(adminId: string, r: RouteInput, reason: string) {
  const why = requireReason(reason);
  if (r.min_delivery_days != null && r.max_delivery_days != null && r.max_delivery_days < r.min_delivery_days) {
    throw new DomainError("Maximum delivery days must be at least the minimum.");
  }
  if (r.enabled && !r.tracking_available && r.tracking_required) {
    throw new DomainError("A route can't require tracking when tracking isn't available on it.");
  }
  if (r.origin_country !== r.destination_country && r.enabled && !r.customs_required && !r.customs_notice) {
    // Cross-border routes need an explicit customs position before enabling (§4.5).
    throw new DomainError("Add a customs notice (or mark customs documents as required) before enabling a cross-border route.");
  }
  const rows = await query<{ id: string }>(
    `INSERT INTO shipping_routes (origin_country, destination_country, enabled, tracking_available, tracking_required,
        carrier_guidance, min_delivery_days, max_delivery_days, postage_estimate_min, postage_estimate_max, postage_currency,
        max_weight_grams, customs_required, customs_notice, restricted_content_notes, risk_level, support_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (origin_country, destination_country) DO UPDATE SET
        enabled = EXCLUDED.enabled, tracking_available = EXCLUDED.tracking_available,
        tracking_required = EXCLUDED.tracking_required, carrier_guidance = EXCLUDED.carrier_guidance,
        min_delivery_days = EXCLUDED.min_delivery_days, max_delivery_days = EXCLUDED.max_delivery_days,
        postage_estimate_min = EXCLUDED.postage_estimate_min, postage_estimate_max = EXCLUDED.postage_estimate_max,
        postage_currency = EXCLUDED.postage_currency, max_weight_grams = EXCLUDED.max_weight_grams,
        customs_required = EXCLUDED.customs_required, customs_notice = EXCLUDED.customs_notice,
        restricted_content_notes = EXCLUDED.restricted_content_notes, risk_level = EXCLUDED.risk_level,
        support_notes = EXCLUDED.support_notes, updated_at = now()
     RETURNING id`,
    [
      r.origin_country, r.destination_country, r.enabled, r.tracking_available, r.tracking_required,
      r.carrier_guidance, r.min_delivery_days, r.max_delivery_days, r.postage_estimate_min, r.postage_estimate_max,
      r.postage_currency, r.max_weight_grams, r.customs_required, r.customs_notice, r.restricted_content_notes,
      r.risk_level, r.support_notes,
    ],
  );
  await audit(pool(), {
    actorId: adminId, action: "route.upsert", targetType: "route", targetId: rows[0].id, reason: why,
    metadata: { origin: r.origin_country, destination: r.destination_country, enabled: r.enabled },
  });
  return rows[0].id;
}
