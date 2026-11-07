import { query, queryOne } from "@/server/db";

// Read models for public pages and shared form options.

export interface Category {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
}

export async function categories() {
  return query<Category>("SELECT id, slug, name, parent_id FROM categories ORDER BY sort");
}

/** Top-level categories with the number of active listings in them or their children. */
export async function categoryCounts() {
  return query<{ slug: string; name: string; n: number }>(
    `SELECT c.slug, c.name, count(l.id)::int AS n
       FROM categories c
       LEFT JOIN listings l
              ON l.status = 'active'
             AND l.category_id IN (SELECT x.id FROM categories x WHERE x.id = c.id OR x.parent_id = c.id)
      WHERE c.parent_id IS NULL
      GROUP BY c.id
      ORDER BY c.sort`,
  );
}

export async function senderCountries(): Promise<string[]> {
  const rows = await query<{ origin_country: string }>(
    "SELECT DISTINCT origin_country FROM listings WHERE status IN ('active', 'reserved') ORDER BY 1",
  );
  return rows.map((r) => r.origin_country);
}

/** Routes configured but not enabled, listed publicly as "being evaluated". */
export async function routesUnderEvaluation() {
  return query<{ origin_country: string; destination_country: string }>(
    "SELECT origin_country, destination_country FROM shipping_routes WHERE NOT enabled ORDER BY 1, 2",
  );
}

export async function recentOutboxEmails(limit = 50) {
  return query<{ id: string; to_email: string; subject: string; body_text: string; created_at: Date; status: string }>(
    "SELECT id, to_email, subject, body_text, created_at, status FROM email_outbox ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
}

export async function databaseIsUp(): Promise<boolean> {
  try {
    await queryOne("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
