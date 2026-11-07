import { NextResponse } from "next/server";
import { problem } from "@/shared/api/http";
import { currentUser } from "@/shared/api/session";
import { can } from "@/server/rbac";
import { query } from "@/server/db";
import { audit } from "@/server/domain/audit";
import { pool } from "@/server/db";

function csv(v: unknown) {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Neutralize spreadsheet formula injection and quote.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Reconciliation export (§16.4): per-member summary vs ledger totals. */
export async function GET() {
  const u = await currentUser();
  if (!u || !can(u.role, "credits.view")) return problem("not-found");
  const rows = await query<Record<string, unknown>>(
    `SELECT u.id AS user_id, u.display_name, coalesce(a.available, 0) AS summary_available, coalesce(a.reserved, 0) AS summary_reserved,
       coalesce(l.av, 0) AS ledger_available, coalesce(l.rs, 0) AS ledger_reserved,
       coalesce(l.earned, 0) AS earned, coalesce(l.spent, 0) AS spent, coalesce(l.adjusted, 0) AS adjusted, coalesce(l.events, 0) AS events,
       (coalesce(a.available, 0) = coalesce(l.av, 0) AND coalesce(a.reserved, 0) = coalesce(l.rs, 0)) AS reconciled
     FROM users u LEFT JOIN credit_accounts a ON a.user_id = u.id
     LEFT JOIN (SELECT user_id, sum(available_delta) AS av, sum(reserved_delta) AS rs,
                  sum(available_delta) FILTER (WHERE event_type = 'credit_earned') AS earned,
                  -sum(reserved_delta) FILTER (WHERE event_type = 'credit_spent') AS spent,
                  sum(available_delta) FILTER (WHERE event_type = 'credit_admin_adjustment') AS adjusted,
                  count(*) AS events
                FROM credit_ledger GROUP BY user_id) l ON l.user_id = u.id
     ORDER BY u.created_at`,
  );
  const header = Object.keys(rows[0] ?? { user_id: "" });
  const body = [header.map(csv).join(","), ...rows.map((r) => header.map((h) => csv(r[h])).join(","))].join("\n");
  await audit(pool(), { actorId: u.id, action: "credit.export", targetType: "ledger", metadata: { rows: rows.length } });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="yos-credit-reconciliation-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
