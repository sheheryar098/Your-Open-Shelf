import type { Client, PoolClient } from "pg";
import { COUNTRY_CODES, countryName, defaultCurrency } from "../src/shared/lib/countries";

type Q = Pick<Client | PoolClient, "query">;

/**
 * Launch configuration (§1.2, §4.3): global access, but transactions only on a small set of
 * verified corridors. Everything else starts on the waitlist and can be opened by admins.
 */
export const LAUNCH_COUNTRIES: Record<string, "open" | "limited"> = {
  GB: "open", IE: "open", US: "open", CA: "open", AU: "limited", NZ: "limited",
};

interface RouteSeed {
  o: string; d: string; enabled: boolean; min: number; max: number; tracking_required: boolean;
  customs?: string; carriers: string; risk?: "low" | "medium" | "high";
}

const CUSTOMS_NOTICE =
  "Cross-border parcel: the sender must complete a truthful customs declaration describing the contents as a used book. " +
  "Import duties, taxes or clearance fees may be charged by the destination country and are not covered by YOS credits. " +
  "Delivery can take longer and is less predictable.";

export const LAUNCH_ROUTES: RouteSeed[] = [
  { o: "GB", d: "GB", enabled: true, min: 1, max: 5, tracking_required: false, carriers: "Royal Mail, Evri, DPD and other national services. Tracked services recommended." },
  { o: "IE", d: "IE", enabled: true, min: 1, max: 5, tracking_required: false, carriers: "An Post and courier services. Tracked services recommended." },
  { o: "US", d: "US", enabled: true, min: 2, max: 8, tracking_required: false, carriers: "USPS Media Mail / Ground Advantage, UPS, FedEx." },
  { o: "CA", d: "CA", enabled: true, min: 2, max: 10, tracking_required: false, carriers: "Canada Post and courier services." },
  { o: "AU", d: "AU", enabled: true, min: 2, max: 10, tracking_required: true, carriers: "Australia Post (tracked) and couriers." },
  { o: "NZ", d: "NZ", enabled: true, min: 1, max: 6, tracking_required: true, carriers: "NZ Post (tracked) and couriers." },
  { o: "GB", d: "IE", enabled: true, min: 3, max: 10, tracking_required: true, customs: CUSTOMS_NOTICE, carriers: "Tracked international services only.", risk: "medium" },
  { o: "IE", d: "GB", enabled: true, min: 3, max: 10, tracking_required: true, customs: CUSTOMS_NOTICE, carriers: "Tracked international services only.", risk: "medium" },
  { o: "US", d: "CA", enabled: true, min: 5, max: 15, tracking_required: true, customs: CUSTOMS_NOTICE, carriers: "Tracked international services only.", risk: "medium" },
  { o: "CA", d: "US", enabled: true, min: 5, max: 15, tracking_required: true, customs: CUSTOMS_NOTICE, carriers: "Tracked international services only.", risk: "medium" },
  { o: "AU", d: "NZ", enabled: true, min: 5, max: 14, tracking_required: true, customs: CUSTOMS_NOTICE, carriers: "Tracked international services only.", risk: "medium" },
  { o: "NZ", d: "AU", enabled: true, min: 5, max: 14, tracking_required: true, customs: CUSTOMS_NOTICE, carriers: "Tracked international services only.", risk: "medium" },
  // Configured but not yet verified — visible as "not supported yet".
  { o: "GB", d: "US", enabled: false, min: 7, max: 21, tracking_required: true, customs: CUSTOMS_NOTICE, carriers: "Pending carrier and customs review.", risk: "high" },
  { o: "US", d: "GB", enabled: false, min: 7, max: 21, tracking_required: true, customs: CUSTOMS_NOTICE, carriers: "Pending carrier and customs review.", risk: "high" },
];

export const CATEGORIES: [string, string, string?][] = [
  ["fiction", "Fiction"],
  ["literary-fiction", "Literary fiction", "fiction"],
  ["mystery-thriller", "Mystery & thriller", "fiction"],
  ["fantasy-scifi", "Fantasy & science fiction", "fiction"],
  ["romance", "Romance", "fiction"],
  ["historical-fiction", "Historical fiction", "fiction"],
  ["non-fiction", "Non-fiction"],
  ["biography-memoir", "Biography & memoir", "non-fiction"],
  ["history", "History", "non-fiction"],
  ["science-nature", "Science & nature", "non-fiction"],
  ["self-help", "Self-help & wellbeing", "non-fiction"],
  ["textbooks", "Textbooks & study"],
  ["childrens", "Children's & young adult"],
  ["comics-manga", "Comics, graphic novels & manga"],
  ["poetry-drama", "Poetry & drama"],
  ["food-drink", "Food & drink"],
  ["art-photography", "Art & photography"],
  ["religion-culture", "Religion, spirituality & culture"],
  ["reference-languages", "Reference & languages"],
];

export async function seedReferenceData(db: Q) {
  for (const code of COUNTRY_CODES) {
    const status = LAUNCH_COUNTRIES[code] ?? "waitlist";
    await db.query(
      `INSERT INTO countries (code, name, status, currency) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO NOTHING`,
      [code, countryName(code), status, defaultCurrency(code)],
    );
  }
  for (const r of LAUNCH_ROUTES) {
    await db.query(
      `INSERT INTO shipping_routes (origin_country, destination_country, enabled, tracking_available, tracking_required,
         carrier_guidance, min_delivery_days, max_delivery_days, customs_required, customs_notice, risk_level, max_weight_grams)
       VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9, $10, 2000)
       ON CONFLICT (origin_country, destination_country) DO NOTHING`,
      [r.o, r.d, r.enabled, r.tracking_required, r.carriers, r.min, r.max, r.o !== r.d, r.customs ?? null, r.risk ?? "low"],
    );
  }
  let sort = 0;
  for (const [slug, name, parent] of CATEGORIES) {
    await db.query(
      `INSERT INTO categories (slug, name, parent_id, sort)
       VALUES ($1, $2, (SELECT id FROM categories WHERE slug = $3), $4) ON CONFLICT (slug) DO NOTHING`,
      [slug, name, parent ?? null, sort++],
    );
  }
}
