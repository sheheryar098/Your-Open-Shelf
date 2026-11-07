import { query, queryOne } from "@/server/db";
import type { ShippingRoute } from "@/server/domain/routes";

// Read models for the staff area. Each function returns exactly what one screen renders,
// with a hard row cap so a large table never reaches the browser unbounded.

export interface MemberRow {
  id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  country_code: string | null;
  created_at: Date;
  email_verified_at: Date | null;
  can_list: boolean;
  can_request: boolean;
  available: number;
  completed: number;
}

export async function searchMembers(filter: { q?: string; status?: string }): Promise<MemberRow[]> {
  const params: unknown[] = [];
  const where = ["true"];
  if (filter.q) {
    params.push(`%${filter.q.toLowerCase()}%`, filter.q);
    where.push(`(lower(u.email) LIKE $1 OR lower(u.display_name) LIKE $1 OR u.id::text = $2)`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`u.status = $${params.length}`);
  }
  return query<MemberRow>(
    `SELECT u.id, u.email, u.display_name, u.role, u.status, u.country_code, u.created_at, u.email_verified_at,
            u.can_list, u.can_request, coalesce(a.available, 0) AS available,
            (SELECT count(*)::int FROM exchanges e
      WHERE (e.sender_id = u.id OR e.requester_id = u.id) AND e.status = 'completed') AS completed
       FROM users u
       LEFT JOIN credit_accounts a ON a.user_id = u.id
      WHERE ${where.join(" AND ")}
      ORDER BY u.created_at DESC
      LIMIT 100`,
    params,
  );
}

export async function memberCaseFile(userId: string) {
  const [exchanges, listingCounts, reports, staffActions] = await Promise.all([
    query<{ id: string; status: string; title: string; role: "sender" | "requester"; updated_at: Date }>(
      `SELECT e.id, e.status, b.title, e.updated_at,
              CASE WHEN e.sender_id = $1 THEN 'sender' ELSE 'requester' END AS role
         FROM exchanges e
         JOIN listings l ON l.id = e.listing_id
         JOIN books b ON b.id = l.book_id
        WHERE e.sender_id = $1 OR e.requester_id = $1
        ORDER BY e.updated_at DESC
        LIMIT 50`,
      [userId],
    ),
    query<{ status: string; n: number }>(
      "SELECT status, count(*)::int AS n FROM listings WHERE owner_id = $1 GROUP BY status",
      [userId],
    ),
    query<{ id: string; reason: string; status: string; created_at: Date }>(
      `SELECT id, reason, status, created_at FROM reports
        WHERE target_type = 'member' AND target_id = $1
        ORDER BY created_at DESC`,
      [userId],
    ),
    query<{ action: string; reason: string | null; created_at: Date; actor: string | null }>(
      `SELECT a.action, a.reason, a.created_at, u.display_name AS actor
         FROM admin_audit_logs a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.target_type = 'user' AND a.target_id = $1
        ORDER BY a.id DESC
        LIMIT 30`,
      [userId],
    ),
  ]);
  return { exchanges, listingCounts, reports, staffActions };
}

export interface AdminListingRow {
  id: string;
  book_id: string;
  title: string;
  authors: string[];
  isbn13: string | null;
  publisher: string | null;
  publication_year: number | null;
  edition: string | null;
  format: string;
  condition: string;
  status: string;
  origin_country: string;
  owner_id: string;
  owner_name: string;
  created_at: Date;
  condition_notes: string;
  photo_id: string | null;
  photo_count: number;
  open_reports: number;
  duplicates: number;
}

export async function searchListingsForModeration(filter: { q?: string; status?: string; flagged?: boolean }) {
  const params: unknown[] = [];
  const where = ["true"];
  if (filter.q) {
    params.push(`%${filter.q.toLowerCase()}%`);
    where.push(`(lower(b.title) LIKE $1 OR lower(u.display_name) LIKE $1 OR b.isbn13 LIKE $1 OR l.id::text LIKE $1)`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`l.status = $${params.length}`);
  }
  if (filter.flagged) {
    where.push(`(
      EXISTS (SELECT 1 FROM reports r WHERE r.target_id = l.id AND r.status = 'open')
      OR EXISTS (SELECT 1 FROM listings d
                  WHERE d.owner_id = l.owner_id AND d.book_id = l.book_id AND d.id <> l.id
                    AND d.status IN ('active', 'reserved', 'paused')))`);
  }
  return query<AdminListingRow>(
    `SELECT l.id, l.book_id, b.title, b.authors, b.isbn13, b.publisher, b.publication_year, b.edition,
            l.format, l.condition, l.status, l.origin_country, l.owner_id, u.display_name AS owner_name,
            l.created_at, l.condition_notes,
            (SELECT file_id FROM listing_photos p WHERE p.listing_id = l.id ORDER BY position LIMIT 1) AS photo_id,
            (SELECT count(*)::int FROM listing_photos p WHERE p.listing_id = l.id) AS photo_count,
            (SELECT count(*)::int FROM reports r WHERE r.target_id = l.id AND r.status = 'open') AS open_reports,
            (SELECT count(*)::int FROM listings d
      WHERE d.owner_id = l.owner_id AND d.book_id = l.book_id AND d.id <> l.id
                AND d.status IN ('active', 'reserved', 'paused')) AS duplicates
       FROM listings l
       JOIN books b ON b.id = l.book_id
       JOIN users u ON u.id = l.owner_id
      WHERE ${where.join(" AND ")}
      ORDER BY open_reports DESC, l.updated_at DESC
      LIMIT 60`,
    params,
  );
}

export async function disputeQueue(includeResolved: boolean) {
  return query<{
    id: string;
    issue_type: string;
    status: string;
    outcome: string | null;
    created_at: Date;
    title: string;
    opener: string;
    assignee: string | null;
    exchange_id: string;
    origin_country: string;
    destination_country: string;
  }>(
    `SELECT d.id, d.issue_type, d.status, d.outcome, d.created_at, d.exchange_id, b.title,
            o.display_name AS opener, a.display_name AS assignee, e.origin_country, e.destination_country
       FROM disputes d
       JOIN exchanges e ON e.id = d.exchange_id
       JOIN listings l ON l.id = e.listing_id
       JOIN books b ON b.id = l.book_id
       JOIN users o ON o.id = d.opened_by
       LEFT JOIN users a ON a.id = d.assigned_to
      ${includeResolved ? "" : "WHERE d.status <> 'resolved'"}
      ORDER BY d.created_at
      LIMIT 200`,
  );
}

export async function openReports() {
  return query<{
    id: string;
    target_type: "listing" | "member" | "review" | "message";
    target_id: string;
    reason: string;
    details: string | null;
    created_at: Date;
    reporter: string;
    reporter_id: string;
    preview: string | null;
    author_id: string | null;
  }>(
    `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.created_at,
            u.display_name AS reporter, r.reporter_id,
            CASE r.target_type
              WHEN 'listing' THEN (SELECT b.title FROM listings l JOIN books b ON b.id = l.book_id WHERE l.id = r.target_id)
              WHEN 'member'  THEN (SELECT display_name FROM users WHERE id = r.target_id)
              WHEN 'review'  THEN (SELECT coalesce(comment, rating || ' stars') FROM reviews WHERE id = r.target_id)
              WHEN 'message' THEN (SELECT body FROM messages WHERE id = r.target_id)
            END AS preview,
            CASE r.target_type
              WHEN 'listing' THEN (SELECT owner_id FROM listings WHERE id = r.target_id)
              WHEN 'member'  THEN r.target_id
              WHEN 'review'  THEN (SELECT reviewer_id FROM reviews WHERE id = r.target_id)
              WHEN 'message' THEN (SELECT sender_id FROM messages WHERE id = r.target_id)
            END AS author_id
       FROM reports r
       JOIN users u ON u.id = r.reporter_id
      WHERE r.status = 'open'
      ORDER BY r.created_at
      LIMIT 100`,
  );
}

export const TICKET_QUEUES = ["active", "open", "in_progress", "awaiting_member", "resolved", "closed", "all"] as const;
export type TicketQueue = (typeof TICKET_QUEUES)[number];

export async function supportQueue(queue: TicketQueue) {
  const filter =
    queue === "active"
      ? "t.status IN ('open', 'in_progress', 'awaiting_member')"
      : queue === "all"
        ? "true"
        : "t.status = $1";
  return query<{
    id: string;
    subject: string;
    category: string;
    status: string;
    priority: string;
    updated_at: Date;
    created_at: Date;
    requester: string | null;
    assignee: string | null;
  }>(
    `SELECT t.id, t.subject, t.category, t.status, t.priority, t.updated_at, t.created_at,
            coalesce(u.display_name, t.contact_email) AS requester, a.display_name AS assignee
       FROM support_tickets t
       LEFT JOIN users u ON u.id = t.user_id
       LEFT JOIN users a ON a.id = t.assigned_to
      WHERE ${filter}
      ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at
      LIMIT 200`,
    queue === "active" || queue === "all" ? [] : [queue],
  );
}

export async function auditLog(filter: { actionPrefix?: string; targetId?: string }) {
  const params: unknown[] = [];
  const where = ["true"];
  if (filter.actionPrefix) {
    params.push(`${filter.actionPrefix}%`);
    where.push(`a.action LIKE $${params.length}`);
  }
  if (filter.targetId) {
    params.push(filter.targetId);
    where.push(`a.target_id = $${params.length}`);
  }
  return query<{
    id: string;
    action: string;
    target_type: string;
    target_id: string | null;
    reason: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
    actor: string | null;
  }>(
    `SELECT a.*, u.display_name AS actor
       FROM admin_audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
      WHERE ${where.join(" AND ")}
      ORDER BY a.id DESC
      LIMIT 200`,
    params,
  );
}

export async function staffMembers() {
  return query<{ id: string; display_name: string; email: string; role: string }>(
    `SELECT id, display_name, email, role FROM users
      WHERE role <> 'member' AND status = 'active'
      ORDER BY role, display_name`,
  );
}

export async function exchangeLedger(exchangeId: string) {
  return query<{
    id: string;
    user_id: string;
    event_type: string;
    available_delta: number;
    reserved_delta: number;
    reason: string;
    created_at: Date;
  }>(
    `SELECT id, user_id, event_type, available_delta, reserved_delta, reason, created_at
       FROM credit_ledger WHERE exchange_id = $1 ORDER BY id`,
    [exchangeId],
  );
}

export async function routesWithPerformance() {
  const [routes, performance] = await Promise.all([
    query<ShippingRoute>("SELECT * FROM shipping_routes ORDER BY enabled DESC, origin_country, destination_country"),
    query<{ route_id: string; total: number; completed: number; disputed: number }>(
      `SELECT route_id,
              count(*)::int AS total,
              count(*) FILTER (WHERE status = 'completed')::int AS completed,
              count(*) FILTER (WHERE id IN (SELECT exchange_id FROM disputes))::int AS disputed
         FROM exchanges
        GROUP BY route_id`,
    ),
  ]);
  const byRoute = new Map(performance.map((p) => [p.route_id, p]));
  return routes.map((route) => ({ route, performance: byRoute.get(route.id) ?? null }));
}

export async function creditOverview(eventType?: string) {
  const [totals, recent, repeatPairs, outstanding] = await Promise.all([
    query<{ event_type: string; n: number; available: number; reserved: number }>(
      `SELECT event_type, count(*)::int AS n, sum(available_delta)::int AS available, sum(reserved_delta)::int AS reserved
         FROM credit_ledger GROUP BY 1 ORDER BY 1`,
    ),
    query<{
      id: string;
      user_id: string;
      display_name: string;
      event_type: string;
      available_delta: number;
      reserved_delta: number;
      reason: string;
      actor_type: string;
      actor_name: string | null;
      exchange_id: string | null;
      created_at: Date;
    }>(
      `SELECT l.id, l.user_id, u.display_name, l.event_type, l.available_delta, l.reserved_delta, l.reason,
              l.actor_type, a.display_name AS actor_name, l.exchange_id, l.created_at
         FROM credit_ledger l
         JOIN users u ON u.id = l.user_id
         LEFT JOIN users a ON a.id = l.actor_id
        WHERE ($1::text IS NULL OR l.event_type = $1)
        ORDER BY l.id DESC
        LIMIT 100`,
      [eventType ?? null],
    ),
    // Members repeatedly completing exchanges with the same counterpart. Often legitimate
    // (friends, book clubs); surfaced for review, never acted on automatically.
    query<{ sender_id: string; sender: string; requester_id: string; requester: string; n: number }>(
      `SELECT e.sender_id, s.display_name AS sender, e.requester_id, r.display_name AS requester, count(*)::int AS n
         FROM exchanges e
         JOIN users s ON s.id = e.sender_id
         JOIN users r ON r.id = e.requester_id
        WHERE e.status = 'completed' AND e.completed_at > now() - interval '90 days'
        GROUP BY 1, 2, 3, 4
       HAVING count(*) >= 3
        ORDER BY n DESC
        LIMIT 20`,
    ),
    queryOne<{ available: number; reserved: number }>(
      `SELECT coalesce(sum(available), 0)::int AS available, coalesce(sum(reserved), 0)::int AS reserved
         FROM credit_accounts`,
    ),
  ]);
  return { totals, recent, repeatPairs, outstanding: outstanding ?? { available: 0, reserved: 0 } };
}

/** Per-member summary against ledger totals, for the reconciliation export. */
export async function reconciliationRows() {
  return query<Record<string, unknown>>(
    `SELECT u.id AS user_id, u.display_name,
            coalesce(a.available, 0) AS summary_available, coalesce(a.reserved, 0) AS summary_reserved,
            coalesce(l.av, 0) AS ledger_available, coalesce(l.rs, 0) AS ledger_reserved,
            coalesce(l.earned, 0) AS earned, coalesce(l.spent, 0) AS spent,
            coalesce(l.adjusted, 0) AS adjusted, coalesce(l.events, 0) AS events,
            (coalesce(a.available, 0) = coalesce(l.av, 0) AND coalesce(a.reserved, 0) = coalesce(l.rs, 0)) AS reconciled
       FROM users u
       LEFT JOIN credit_accounts a ON a.user_id = u.id
       LEFT JOIN (
             SELECT user_id,
                    sum(available_delta) AS av,
                    sum(reserved_delta) AS rs,
                    sum(available_delta) FILTER (WHERE event_type = 'credit_earned') AS earned,
                    -sum(reserved_delta) FILTER (WHERE event_type = 'credit_spent') AS spent,
                    sum(available_delta) FILTER (WHERE event_type = 'credit_admin_adjustment') AS adjusted,
                    count(*) AS events
       FROM credit_ledger
      GROUP BY user_id
            ) l ON l.user_id = u.id
      ORDER BY u.created_at`,
  );
}

export async function openJobFailures() {
  return query<{ id: string; job: string; entity_id: string; error: string; attempts: number; last_failed_at: Date }>(
    `SELECT id, job, entity_id, error, attempts, last_failed_at FROM job_failures
      WHERE resolved_at IS NULL
      ORDER BY last_failed_at DESC
      LIMIT 100`,
  );
}

export async function deadEmails() {
  return query<{
    id: string;
    to_email: string;
    subject: string;
    attempts: number;
    last_error: string | null;
    created_at: Date;
  }>(
    `SELECT id, to_email, subject, attempts, last_error, created_at FROM email_outbox
      WHERE status = 'dead'
      ORDER BY created_at DESC
      LIMIT 50`,
  );
}

export async function allAnnouncements() {
  return query<{ id: string; message: string; level: string; active: boolean; created_at: Date }>(
    "SELECT id, message, level, active, created_at FROM announcements ORDER BY created_at DESC LIMIT 50",
  );
}
