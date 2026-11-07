import type { PoolClient } from "pg";
import { z } from "zod";
import { query, queryOne, tx, type Db } from "@/lib/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { policy } from "@/lib/config";
import { now } from "@/lib/clock";
import { CONDITIONS, FORMATS, LANGUAGES } from "@/lib/vocab";
import { isCountryCode } from "@/lib/countries";
import { findOrCreateBook, type BookInput } from "./catalog";
import { saveUpload } from "./files";
import { notify } from "./notifications";
import { audit, requireReason } from "./audit";
import { checkEligibility, TRANSACTING_STATUSES } from "./routes";
import { getUser } from "./users";

export interface Listing {
  id: string;
  book_id: string;
  owner_id: string;
  format: string;
  language: string;
  condition: keyof typeof CONDITIONS;
  condition_notes: string;
  edition_notes: string | null;
  category_id: number | null;
  weight_grams: number | null;
  origin_country: string;
  ship_scope: "domestic" | "international";
  ship_countries: string[];
  credit_cost: number;
  status: "draft" | "active" | "reserved" | "unavailable" | "paused" | "exchanged" | "removed" | "under_review";
  status_reason: string | null;
  possession_confirmed_at: Date | null;
  confirmed_available_at: Date | null;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const copySchema = z.object({
  format: z.enum(Object.keys(FORMATS) as [string, ...string[]], { message: "Choose a format." }),
  language: z.string().refine((l) => l in LANGUAGES, "Choose a language."),
  condition: z.enum(Object.keys(CONDITIONS) as [string, ...string[]], { message: "Choose a condition." }),
  conditionNotes: z.string().trim().max(2000),
  editionNotes: z.string().trim().max(300).optional().default(""),
  categoryId: z.coerce.number().int().positive().optional().nullable(),
  weightGrams: z.coerce.number().int().positive().max(30000).optional().nullable(),
  shipScope: z.enum(["domestic", "international"]),
  shipCountries: z.array(z.string().refine(isCountryCode)).default([]),
});
export type CopyInput = z.infer<typeof copySchema>;

async function lockOwnListing(c: PoolClient, ownerId: string, id: string): Promise<Listing> {
  const l = (await c.query<Listing>("SELECT * FROM listings WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!l) throw new NotFoundError("Listing");
  if (l.owner_id !== ownerId) throw new ForbiddenError();
  return l;
}

export async function createListing(ownerId: string, book: { bookId?: string | null; input?: BookInput }, copy: CopyInput) {
  const owner = await getUser(ownerId);
  if (!owner || owner.status !== "active") throw new ForbiddenError();
  if (!owner.can_list) throw new DomainError("Listing is currently restricted on your account. Contact support for details.");
  if (!owner.country_code) throw new DomainError("Set your country in your profile before listing a book.");
  return tx(async (c) => {
    let bookId = book.bookId ?? null;
    if (bookId) {
      const exists = (await c.query("SELECT 1 FROM books WHERE id = $1", [bookId])).rowCount;
      if (!exists) throw new NotFoundError("Catalog record");
    } else if (book.input) {
      bookId = (await findOrCreateBook(c, book.input)).id;
    } else {
      throw new DomainError("Choose a catalog record or enter the book's details.");
    }
    const row = (
      await c.query<{ id: string }>(
        `INSERT INTO listings (book_id, owner_id, format, language, condition, condition_notes, edition_notes, category_id,
           weight_grams, origin_country, ship_scope, ship_countries, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft') RETURNING id`,
        [bookId, ownerId, copy.format, copy.language, copy.condition, copy.conditionNotes, copy.editionNotes || null,
          copy.categoryId ?? null, copy.weightGrams ?? null, owner.country_code, copy.shipScope, copy.shipCountries],
      )
    ).rows[0];
    return row.id;
  });
}

export async function updateListing(ownerId: string, id: string, copy: CopyInput) {
  await tx(async (c) => {
    const l = await lockOwnListing(c, ownerId, id);
    if (!["draft", "active", "paused", "unavailable"].includes(l.status)) {
      throw new DomainError("This listing can't be edited while it's reserved, exchanged, removed or under review.");
    }
    await c.query(
      `UPDATE listings SET format = $2, language = $3, condition = $4, condition_notes = $5, edition_notes = $6,
         category_id = $7, weight_grams = $8, ship_scope = $9, ship_countries = $10, updated_at = now() WHERE id = $1`,
      [id, copy.format, copy.language, copy.condition, copy.conditionNotes, copy.editionNotes || null,
        copy.categoryId ?? null, copy.weightGrams ?? null, copy.shipScope, copy.shipCountries],
    );
  });
}

export async function addListingPhotos(ownerId: string, id: string, files: File[]) {
  const real = files.filter((f) => f && f.size > 0);
  if (real.length === 0) throw new DomainError("Choose at least one photo.");
  await tx(async (c) => {
    const l = await lockOwnListing(c, ownerId, id);
    if (["exchanged", "removed"].includes(l.status)) throw new DomainError("Photos can't be changed on this listing.");
    const count = Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM listing_photos WHERE listing_id = $1", [id])).rows[0].n);
    if (count + real.length > policy.maxPhotosPerListing) {
      throw new DomainError(`A listing can have up to ${policy.maxPhotosPerListing} photos.`);
    }
    let pos = count;
    for (const f of real) {
      const fileId = await saveUpload(c, f, "listing_photo", ownerId);
      await c.query("INSERT INTO listing_photos (listing_id, file_id, position) VALUES ($1, $2, $3)", [id, fileId, pos++]);
    }
    await c.query("UPDATE listings SET updated_at = now() WHERE id = $1", [id]);
  });
}

export async function removeListingPhoto(ownerId: string, listingId: string, photoId: string) {
  await tx(async (c) => {
    const l = await lockOwnListing(c, ownerId, listingId);
    const count = Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM listing_photos WHERE listing_id = $1", [listingId])).rows[0].n);
    if (count <= 1 && ["active", "reserved"].includes(l.status)) {
      throw new DomainError("A published listing needs at least one photo of the actual copy.");
    }
    await c.query("DELETE FROM listing_photos WHERE id = $1 AND listing_id = $2", [photoId, listingId]);
  });
}

/**
 * Publishing enforces the listing standard (§7.2–7.4): actual-copy photo, written condition
 * disclosure, confirmed possession, verified email, plan listing limit, transacting country.
 */
export async function publishListing(ownerId: string, id: string, opts: { confirmPossession: boolean; confirmAnotherCopy?: boolean }) {
  const owner = await getUser(ownerId);
  if (!owner || owner.status !== "active") throw new ForbiddenError();
  if (!owner.email_verified_at) throw new DomainError("Verify your email address before publishing listings.");
  if (!owner.can_list) throw new DomainError("Listing is currently restricted on your account.");
  if (!opts.confirmPossession) throw new DomainError("Confirm that the book is in your possession and ready to ship.");
  return tx(async (c) => {
    const l = await lockOwnListing(c, ownerId, id);
    if (!["draft", "paused", "unavailable"].includes(l.status)) throw new DomainError("This listing can't be published right now.");
    const country = (await c.query<{ status: string }>("SELECT status FROM countries WHERE code = $1", [l.origin_country])).rows[0];
    if (!country || !TRANSACTING_STATUSES.has(country.status)) {
      throw new DomainError("YOS isn't open for exchanges in your country yet. Your draft is saved, and we'll let you know when it opens.");
    }
    const photos = Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM listing_photos WHERE listing_id = $1", [id])).rows[0].n);
    if (photos < 1) throw new DomainError("Add at least one photo of your actual copy before publishing.");
    if (l.condition_notes.trim().length < 10) {
      throw new DomainError("Describe the copy's condition (at least a short sentence), including any wear or defects.");
    }
    const active = Number((await c.query<{ n: string }>(
      "SELECT count(*) AS n FROM listings WHERE owner_id = $1 AND status IN ('active','reserved')", [ownerId])).rows[0].n);
    const limit = policy.activeListingLimit[owner.plan] ?? policy.activeListingLimit.free;
    if (active >= limit) throw new DomainError(`You've reached the limit of ${limit} active listings on your plan.`);
    const dup = (await c.query(
      "SELECT 1 FROM listings WHERE owner_id = $1 AND book_id = $2 AND id <> $3 AND status IN ('active','reserved','paused')",
      [ownerId, l.book_id, id])).rowCount;
    if (dup && !opts.confirmAnotherCopy) {
      throw new DomainError("You already have a listing for this book. Tick “I have another copy” if this is a separate physical copy.", "duplicate_listing");
    }
    const t = now();
    await c.query(
      `UPDATE listings SET status = 'active', status_reason = NULL, possession_confirmed_at = $2, confirmed_available_at = $2,
         published_at = coalesce(published_at, $2), updated_at = now() WHERE id = $1`,
      [id, t],
    );
    await notifyWishlistMatches(c, { ...l, status: "active" });
  });
}

export async function setOwnListingStatus(ownerId: string, id: string, action: "pause" | "resume" | "remove" | "reconfirm") {
  await tx(async (c) => {
    const l = await lockOwnListing(c, ownerId, id);
    if (l.status === "reserved") throw new DomainError("This book has a request in progress. Respond to the request first.");
    if (l.status === "under_review" || l.status === "exchanged") throw new DomainError("This listing can't be changed.");
    const t = now();
    switch (action) {
      case "pause":
        if (l.status !== "active") throw new DomainError("Only active listings can be paused.");
        await c.query("UPDATE listings SET status = 'paused', updated_at = now() WHERE id = $1", [id]);
        break;
      case "resume":
      case "reconfirm":
        if (l.status === "active") {
          await c.query("UPDATE listings SET confirmed_available_at = $2, updated_at = now() WHERE id = $1", [id, t]);
          break;
        }
        if (!["paused", "unavailable"].includes(l.status)) throw new DomainError("This listing can't be resumed.");
        // Resuming re-runs publish checks via the normal path.
        break;
      case "remove":
        await c.query("UPDATE listings SET status = 'removed', status_reason = 'Removed by member', updated_at = now() WHERE id = $1", [id]);
        break;
    }
  });
  if (action === "resume" || action === "reconfirm") {
    const l = await queryOne<Listing>("SELECT * FROM listings WHERE id = $1", [id]);
    if (l && l.status !== "active") await publishListing(ownerId, id, { confirmPossession: true, confirmAnotherCopy: true });
  }
}

// ---------------------------------------------------------------------------
// Wish-list alerts (§8.4)
// ---------------------------------------------------------------------------

async function notifyWishlistMatches(c: PoolClient, l: Listing) {
  const wishers = (
    await c.query<{ id: string; user_id: string; country_code: string | null; title: string }>(
      `SELECT w.id, w.user_id, u.country_code, b.title FROM wishlist_items w
       JOIN users u ON u.id = w.user_id AND u.status = 'active'
       JOIN books b ON b.id = w.book_id
       WHERE w.book_id = $1 AND w.user_id <> $2
         AND (w.format IS NULL OR w.format = $3) AND (w.language IS NULL OR w.language = $4)
         AND (w.last_notified_at IS NULL OR w.last_notified_at < $5)`,
      [l.book_id, l.owner_id, l.format, l.language, new Date(now().getTime() - 86_400_000)],
    )
  ).rows;
  for (const w of wishers) {
    if (!w.country_code) continue;
    const elig = await checkEligibility(l, w.country_code, c);
    if (!elig.ok) continue; // only alert when the book can actually reach the member's region
    await notify(c, w.user_id, {
      type: "wishlist_match",
      title: `“${w.title}” from your wish list is available`,
      body: "A member just listed a copy that can ship to you.",
      link: `/books/${l.id}`,
    });
    await c.query("UPDATE wishlist_items SET last_notified_at = $2 WHERE id = $1", [w.id, now()]);
  }
}

export async function addToWishlist(userId: string, bookId: string, prefs: { format?: string | null; language?: string | null } = {}) {
  await query(
    `INSERT INTO wishlist_items (user_id, book_id, format, language) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, book_id) DO UPDATE SET format = EXCLUDED.format, language = EXCLUDED.language`,
    [userId, bookId, prefs.format || null, prefs.language || null],
  );
}

export async function removeFromWishlist(userId: string, itemId: string) {
  await query("DELETE FROM wishlist_items WHERE id = $1 AND user_id = $2", [itemId, userId]);
}

// ---------------------------------------------------------------------------
// Staff moderation (§7.5, §16.3)
// ---------------------------------------------------------------------------

export async function moderateListing(staffId: string, id: string, status: "removed" | "under_review" | "active" | "paused", reason: string) {
  const why = requireReason(reason);
  await tx(async (c) => {
    const l = (await c.query<Listing>("SELECT * FROM listings WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!l) throw new NotFoundError("Listing");
    if (l.status === "reserved" && status !== "under_review") {
      throw new DomainError("This listing has a live exchange. Resolve the exchange first, or mark it under review.");
    }
    const next = l.status === "reserved" && status === "under_review" ? "reserved" : status;
    await c.query("UPDATE listings SET status = $2, status_reason = $3, updated_at = now() WHERE id = $1", [id, next, why]);
    await audit(c, { actorId: staffId, action: `listing.${status}`, targetType: "listing", targetId: id, reason: why, metadata: { from: l.status } });
    await notify(c, l.owner_id, {
      type: "listing",
      title: status === "active" ? "Your listing was restored" : status === "removed" ? "Your listing was removed" : "Your listing is under review",
      body: `Reason: ${why}`,
      link: `/my/books/${id}`,
    });
  });
}

/** Pauses listings not reconfirmed within the stale window (§7.5). */
export async function pauseStaleListings(db: Db) {
  const cutoff = new Date(now().getTime() - policy.staleListingDays * 86_400_000);
  const rows = await query<{ id: string; owner_id: string; title: string }>(
    `UPDATE listings l SET status = 'paused', status_reason = 'Please reconfirm this book is still available', updated_at = now()
     FROM books b WHERE b.id = l.book_id AND l.status = 'active' AND l.confirmed_available_at < $1
     RETURNING l.id, l.owner_id, b.title`,
    [cutoff],
    db,
  );
  for (const r of rows) {
    await notify(db, r.owner_id, {
      type: "listing",
      title: `Is “${r.title}” still on your shelf?`,
      body: "We paused this listing because it hasn't been confirmed recently. Resume it if the book is still available.",
      link: `/my/books/${r.id}`,
    });
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface ListingCard {
  id: string;
  title: string;
  authors: string[];
  format: string;
  condition: string;
  language: string;
  origin_country: string;
  status: string;
  published_at: Date | null;
  photo_id: string | null;
  owner_name: string;
}

const CARD_SELECT = `
  l.id, b.title, b.authors, l.format, l.condition, l.language, l.origin_country, l.status, l.published_at,
  u.display_name AS owner_name,
  (SELECT p.file_id FROM listing_photos p WHERE p.listing_id = l.id ORDER BY p.position LIMIT 1) AS photo_id`;

export interface SearchFilters {
  q?: string;
  format?: string;
  language?: string;
  condition?: string;
  category?: string;
  senderCountry?: string;
  /** Destination country of the viewer, for "ships to me" filtering. */
  shipsTo?: string;
  availability?: "domestic" | "international";
  sort?: "newest" | "relevance" | "title";
  page?: number;
  pageSize?: number;
}

const CONDITION_RANK = { like_new: 4, very_good: 3, good: 2, acceptable: 1 } as Record<string, number>;

export async function searchListings(f: SearchFilters) {
  const params: unknown[] = [];
  const where: string[] = ["l.status IN ('active', 'reserved')", "u.status = 'active'"];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  let rank = "0";
  if (f.q?.trim()) {
    const q = f.q.trim();
    const digits = q.replace(/[\s-]/g, "");
    if (/^(\d{9}[\dXx]|\d{13})$/.test(digits)) {
      where.push(`(b.isbn13 = ${p(digits)} OR b.isbn10 = ${p(digits.toUpperCase())})`);
    } else {
      const qp = p(q);
      where.push(`(b.search_vector @@ websearch_to_tsquery('simple', ${qp}) OR lower(b.title) LIKE '%' || lower(${qp}) || '%'
        OR lower(array_to_string(b.authors, ' ')) LIKE '%' || lower(${qp}) || '%')`);
      rank = `ts_rank(b.search_vector, websearch_to_tsquery('simple', ${qp}))`;
    }
  }
  if (f.format) where.push(`l.format = ${p(f.format)}`);
  if (f.language) where.push(`l.language = ${p(f.language)}`);
  if (f.condition && CONDITION_RANK[f.condition]) {
    const allowed = Object.entries(CONDITION_RANK).filter(([, r]) => r >= CONDITION_RANK[f.condition!]).map(([k]) => k);
    where.push(`l.condition = ANY(${p(allowed)})`);
  }
  if (f.category) where.push(`l.category_id IN (SELECT id FROM categories WHERE slug = ${p(f.category)} OR parent_id = (SELECT id FROM categories WHERE slug = ${p(f.category)}))`);
  if (f.senderCountry) where.push(`l.origin_country = ${p(f.senderCountry)}`);
  if (f.shipsTo) {
    const dest = p(f.shipsTo);
    where.push(`EXISTS (SELECT 1 FROM shipping_routes r
      JOIN countries oc ON oc.code = r.origin_country AND oc.status IN ('open','limited')
      JOIN countries dc ON dc.code = r.destination_country AND dc.status IN ('open','limited')
      WHERE r.enabled AND r.origin_country = l.origin_country AND r.destination_country = ${dest})`);
    where.push(`(l.origin_country = ${dest} OR (l.ship_scope = 'international' AND (cardinality(l.ship_countries) = 0 OR ${dest} = ANY(l.ship_countries))))`);
    if (f.availability === "domestic") where.push(`l.origin_country = ${dest}`);
    if (f.availability === "international") where.push(`l.origin_country <> ${dest}`);
  }
  const order =
    f.sort === "title" ? "b.title ASC" : f.sort === "relevance" && rank !== "0" ? `${rank} DESC, l.published_at DESC` : "l.published_at DESC";
  const pageSize = Math.min(f.pageSize ?? 24, 60);
  const page = Math.max(1, f.page ?? 1);
  const base = `FROM listings l JOIN books b ON b.id = l.book_id JOIN users u ON u.id = l.owner_id WHERE ${where.join(" AND ")}`;
  const [rows, total] = await Promise.all([
    query<ListingCard>(`SELECT ${CARD_SELECT} ${base} ORDER BY (l.status = 'active') DESC, ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params),
    queryOne<{ n: string }>(`SELECT count(*) AS n ${base}`, params),
  ]);
  return { rows, total: Number(total?.n ?? 0), page, pageSize };
}

export async function recentListings(limit = 8) {
  return query<ListingCard>(
    `SELECT ${CARD_SELECT} FROM listings l JOIN books b ON b.id = l.book_id JOIN users u ON u.id = l.owner_id
     WHERE l.status = 'active' AND u.status = 'active' ORDER BY l.published_at DESC LIMIT $1`,
    [limit],
  );
}

export async function listingsForOwner(ownerId: string) {
  return query<ListingCard & { updated_at: Date; status_reason: string | null; request_count: number }>(
    `SELECT ${CARD_SELECT}, l.updated_at, l.status_reason,
       (SELECT count(*)::int FROM exchanges e WHERE e.listing_id = l.id) AS request_count
     FROM listings l JOIN books b ON b.id = l.book_id JOIN users u ON u.id = l.owner_id
     WHERE l.owner_id = $1 AND l.status <> 'removed' ORDER BY l.updated_at DESC`,
    [ownerId],
  );
}

export async function getListingDetail(id: string) {
  const l = await queryOne<Listing & {
    title: string; subtitle: string | null; authors: string[]; isbn13: string | null; publisher: string | null;
    publication_year: number | null; edition: string | null; book_language: string | null;
    owner_name: string; owner_since: Date; owner_country: string | null; owner_status: string; category_name: string | null;
  }>(
    `SELECT l.*, b.title, b.subtitle, b.authors, b.isbn13, b.publisher, b.publication_year, b.edition, b.language AS book_language,
       u.display_name AS owner_name, u.created_at AS owner_since, u.country_code AS owner_country, u.status AS owner_status,
       c.name AS category_name
     FROM listings l JOIN books b ON b.id = l.book_id JOIN users u ON u.id = l.owner_id
     LEFT JOIN categories c ON c.id = l.category_id
     WHERE l.id = $1`,
    [id],
  );
  if (!l) return null;
  const photos = await query<{ id: string; file_id: string }>(
    "SELECT id, file_id FROM listing_photos WHERE listing_id = $1 ORDER BY position",
    [id],
  );
  return { ...l, photos };
}
