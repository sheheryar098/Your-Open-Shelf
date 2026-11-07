import { NextResponse } from "next/server";
import { problem } from "@/shared/api/http";
import { currentUser } from "@/shared/api/session";
import { can } from "@/server/rbac";
import { reconciliationRows } from "@/server/queries/admin";
import { auditStaffAction } from "@/server/domain/audit";

function csv(v: unknown) {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Neutralize spreadsheet formula injection and quote.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** CSV of every wallet summary next to its ledger totals. */
export async function GET() {
  const u = await currentUser();
  if (!u || !can(u.role, "credits.view")) return problem("not-found");
  const rows = await reconciliationRows();
  const header = Object.keys(rows[0] ?? { user_id: "" });
  const body = [header.map(csv).join(","), ...rows.map((r) => header.map((h) => csv(r[h])).join(","))].join("\n");
  await auditStaffAction({
    actorId: u.id,
    action: "credit.export",
    targetType: "ledger",
    metadata: { rows: rows.length },
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="yos-credit-reconciliation-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
