import { query, queryOne } from "@/server/db";

const n = (v: unknown) => Number(v ?? 0);

/** Admin overview counters (§16.1). */
export async function overview() {
  const r = await queryOne<Record<string, string>>(`
    SELECT
      (SELECT count(*) FROM users WHERE status <> 'closed') AS members,
      (SELECT count(*) FROM users WHERE last_login_at > now() - interval '30 days') AS active_members,
      (SELECT count(*) FROM users WHERE created_at > now() - interval '7 days') AS new_members_7d,
      (SELECT count(*) FROM listings WHERE status = 'active') AS active_listings,
      (SELECT count(*) FROM exchanges WHERE requested_at > now() - interval '30 days') AS requests_30d,
      (SELECT count(*) FROM exchanges WHERE status = 'completed' AND completed_at > now() - interval '30 days') AS completed_30d,
      (SELECT count(*) FROM exchanges WHERE status IN ('requested','accepted','shipped','delivered','disputed')) AS live_exchanges,
      (SELECT count(*) FROM disputes WHERE status <> 'resolved') AS open_disputes,
      (SELECT count(*) FROM reports WHERE status = 'open') AS open_reports,
      (SELECT count(*) FROM support_tickets WHERE status IN ('open','in_progress')) AS open_tickets,
      (SELECT coalesce(sum(available_delta), 0) FROM credit_ledger WHERE event_type = 'credit_earned' AND created_at > now() - interval '30 days') AS credits_issued_30d,
      (SELECT coalesce(-sum(reserved_delta), 0) FROM credit_ledger WHERE event_type = 'credit_spent' AND created_at > now() - interval '30 days') AS credits_redeemed_30d,
      (SELECT coalesce(sum(available + reserved), 0) FROM credit_accounts) AS credits_outstanding,
      (SELECT avg(extract(epoch FROM shipped_at - accepted_at) / 3600) FROM exchanges WHERE shipped_at > now() - interval '90 days') AS avg_dispatch_hours
  `);
  return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, n(v)])) as Record<string, number>;
}

/** Marketplace, trust and route KPIs (§23). North star: successful exchanges per month. */
export async function kpis() {
  const monthly = await query<{ month: string; completed: string; requested: string }>(`
    SELECT to_char(m, 'YYYY-MM') AS month,
      (SELECT count(*) FROM exchanges WHERE status = 'completed' AND date_trunc('month', completed_at) = m
         AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.exchange_id = exchanges.id AND d.status <> 'resolved')) AS completed,
      (SELECT count(*) FROM exchanges WHERE date_trunc('month', requested_at) = m) AS requested
    FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m
    ORDER BY m`);

  const funnel = await queryOne<Record<string, string>>(`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE accepted_at IS NOT NULL) AS accepted,
      count(*) FILTER (WHERE status NOT IN ('requested')) AS responded,
      count(*) FILTER (WHERE shipped_at IS NOT NULL) AS shipped,
      count(*) FILTER (WHERE shipped_at IS NOT NULL AND shipped_at <= dispatch_by) AS shipped_on_time,
      count(*) FILTER (WHERE status = 'completed') AS completed,
      count(*) FILTER (WHERE status = 'refunded') AS refunded,
      count(*) FILTER (WHERE id IN (SELECT exchange_id FROM disputes)) AS disputed,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM shipped_at - accepted_at) / 3600) FILTER (WHERE shipped_at IS NOT NULL) AS median_dispatch_hours
    FROM exchanges WHERE requested_at > now() - interval '90 days'`);

  const listingToRequest = await queryOne<{ median_hours: string | null }>(`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_req - l.published_at) / 3600) AS median_hours
    FROM listings l JOIN (SELECT listing_id, min(requested_at) AS first_req FROM exchanges GROUP BY listing_id) f ON f.listing_id = l.id
    WHERE l.published_at IS NOT NULL`);

  const participation = await queryOne<{ both: string; members: string; listers: string; requesters: string }>(`
    SELECT
      (SELECT count(*) FROM users u WHERE EXISTS (SELECT 1 FROM exchanges e WHERE e.sender_id = u.id AND e.status = 'completed')
         AND EXISTS (SELECT 1 FROM exchanges e WHERE e.requester_id = u.id AND e.status = 'completed')) AS both,
      (SELECT count(*) FROM users WHERE status = 'active') AS members,
      (SELECT count(DISTINCT owner_id) FROM listings WHERE published_at IS NOT NULL) AS listers,
      (SELECT count(DISTINCT requester_id) FROM exchanges) AS requesters`);

  const routes = await query<{ origin: string; destination: string; total: string; completed: string; disputed: string; avg_delivery_days: string | null; cancelled: string }>(`
    SELECT e.origin_country AS origin, e.destination_country AS destination,
      count(*) AS total,
      count(*) FILTER (WHERE e.status = 'completed') AS completed,
      count(*) FILTER (WHERE e.id IN (SELECT exchange_id FROM disputes)) AS disputed,
      count(*) FILTER (WHERE e.status IN ('cancelled','expired','declined')) AS cancelled,
      avg(extract(epoch FROM e.delivered_at - e.shipped_at) / 86400) FILTER (WHERE e.delivered_at IS NOT NULL) AS avg_delivery_days
    FROM exchanges e GROUP BY 1, 2 ORDER BY count(*) DESC LIMIT 50`);

  const countries = await query<{ code: string; members: string; listings: string }>(`
    SELECT c.code,
      (SELECT count(*) FROM users u WHERE u.country_code = c.code AND u.status = 'active') AS members,
      (SELECT count(*) FROM listings l WHERE l.origin_country = c.code AND l.status = 'active') AS listings
    FROM countries c WHERE c.status IN ('open','limited') OR EXISTS (SELECT 1 FROM users u WHERE u.country_code = c.code)
    ORDER BY members DESC LIMIT 40`);

  const trust = await queryOne<Record<string, string>>(`
    SELECT
      (SELECT count(*) FROM reports WHERE created_at > now() - interval '90 days') AS reports_90d,
      (SELECT count(*) FROM disputes WHERE created_at > now() - interval '90 days') AS disputes_90d,
      (SELECT count(*) FROM disputes WHERE issue_type IN ('delivered_not_received','tracking_not_updating') AND created_at > now() - interval '90 days') AS non_delivery_90d,
      (SELECT count(*) FROM disputes WHERE issue_type IN ('damaged','wrong_book','condition_mismatch') AND created_at > now() - interval '90 days') AS misdescription_90d,
      (SELECT avg(extract(epoch FROM decided_at - created_at) / 3600) FROM disputes WHERE decided_at IS NOT NULL) AS avg_resolution_hours,
      (SELECT avg(rating) FROM reviews WHERE hidden_at IS NULL) AS avg_rating`);

  return {
    monthly: monthly.map((m) => ({ month: m.month, completed: n(m.completed), requested: n(m.requested) })),
    funnel: Object.fromEntries(Object.entries(funnel ?? {}).map(([k, v]) => [k, n(v)])) as Record<string, number>,
    medianListingToRequestHours: listingToRequest?.median_hours ? Number(listingToRequest.median_hours) : null,
    participation: { both: n(participation?.both), members: n(participation?.members), listers: n(participation?.listers), requesters: n(participation?.requesters) },
    routes: routes.map((r) => ({ ...r, total: n(r.total), completed: n(r.completed), disputed: n(r.disputed), cancelled: n(r.cancelled), avg_delivery_days: r.avg_delivery_days ? Number(r.avg_delivery_days) : null })),
    countries: countries.map((c) => ({ code: c.code, members: n(c.members), listings: n(c.listings) })),
    trust: Object.fromEntries(Object.entries(trust ?? {}).map(([k, v]) => [k, n(v)])) as Record<string, number>,
  };
}
