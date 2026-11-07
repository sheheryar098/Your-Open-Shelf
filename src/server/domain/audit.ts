import { query, type Db } from "@/server/db";
import { DomainError } from "@/server/errors";

export interface AuditInput {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/** Records a sensitive staff action. The table is append-only at the database level. */
export async function audit(db: Db, a: AuditInput) {
  await query(
    `INSERT INTO admin_audit_logs (actor_id, action, target_type, target_id, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [a.actorId, a.action, a.targetType, a.targetId ?? null, a.reason ?? null, JSON.stringify(a.metadata ?? {})],
    db,
  );
}

export function requireReason(reason: unknown, min = 5): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < min) throw new DomainError("Please record a reason for this action.");
  return r;
}
