import { query, queryOne } from "@/server/db";
import type { ListingCard } from "@/server/domain/listings";

// Read models for member-facing screens. All of them are scoped to the signed-in member
// (or to public data) by their arguments; authorization happens in the calling page.

export async function availableCredits(userId: string): Promise<number> {
  const row = await queryOne<{ available: number }>("SELECT available FROM credit_accounts WHERE user_id = $1", [
    userId,
  ]);
  return row?.available ?? 0;
}

export async function notificationsFor(userId: string, limit = 100) {
  return query<{
    id: string;
    title: string;
    body: string | null;
    link: string | null;
    read_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, title, body, link, read_at, created_at FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
}

export async function recentWishlistMatches(userId: string, limit = 5) {
  return query<{ id: string; title: string; link: string | null; created_at: Date }>(
    `SELECT id, title, link, created_at FROM notifications
      WHERE user_id = $1 AND type = 'wishlist_match'
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, limit],
  );
}

export async function listingCountsByStatus(userId: string) {
  const rows = await query<{ status: string; n: number }>(
    "SELECT status, count(*)::int AS n FROM listings WHERE owner_id = $1 GROUP BY status",
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}

export async function onboardingProgress(userId: string) {
  const row = await queryOne<{ addresses: number; listings: number }>(
    `SELECT (SELECT count(*)::int FROM addresses WHERE user_id = $1 AND deleted_at IS NULL) AS addresses,
            (SELECT count(*)::int FROM listings WHERE owner_id = $1) AS listings`,
    [userId],
  );
  return { addresses: row?.addresses ?? 0, listings: row?.listings ?? 0 };
}

export async function wishlistFor(userId: string) {
  return query<{
    id: string;
    book_id: string;
    title: string;
    authors: string[];
    format: string | null;
    language: string | null;
    created_at: Date;
    available: number;
  }>(
    `SELECT w.id, w.book_id, b.title, b.authors, w.format, w.language, w.created_at,
            (SELECT count(*)::int FROM listings l
      WHERE l.book_id = w.book_id AND l.status = 'active' AND l.owner_id <> $1) AS available
       FROM wishlist_items w
       JOIN books b ON b.id = w.book_id
      WHERE w.user_id = $1
      ORDER BY w.created_at DESC`,
    [userId],
  );
}

export async function isOnWishlist(userId: string, bookId: string): Promise<boolean> {
  return !!(await queryOne("SELECT 1 FROM wishlist_items WHERE user_id = $1 AND book_id = $2", [userId, bookId]));
}

export async function requestHistoryForListing(listingId: string) {
  return query<{ id: string; status: string; requested_at: Date }>(
    "SELECT id, status, requested_at FROM exchanges WHERE listing_id = $1 ORDER BY requested_at DESC",
    [listingId],
  );
}

/** Books currently on a member's public shelf. */
export async function shelfOf(userId: string, limit = 24) {
  return query<ListingCard>(
    `SELECT l.id, b.title, b.authors, l.format, l.condition, l.language, l.origin_country, l.status,
            l.published_at, '' AS owner_name,
            (SELECT file_id FROM listing_photos WHERE listing_id = l.id ORDER BY position LIMIT 1) AS photo_id
       FROM listings l
       JOIN books b ON b.id = l.book_id
      WHERE l.owner_id = $1 AND l.status IN ('active', 'reserved')
      ORDER BY l.published_at DESC
      LIMIT $2`,
    [userId, limit],
  );
}
