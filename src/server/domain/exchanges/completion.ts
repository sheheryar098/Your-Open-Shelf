import { tx } from "@/server/db";
import { DomainError, ForbiddenError } from "@/server/errors";
import { now } from "@/server/clock";
import { can } from "@/server/rbac";
import { audit, requireReason } from "../audit";
import { lockExchange, complete, markDelivered } from "./core";

/** Recipient confirms the book arrived as described: completes immediately (they waive the dispute window). */
export async function confirmReceipt(requesterId: string, exchangeId: string) {
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.requester_id !== requesterId) throw new ForbiddenError();
    if (ex.status !== "shipped" && ex.status !== "delivered")
      throw new DomainError("This exchange isn't awaiting your confirmation.");
    const patch: Record<string, unknown> = {};
    if (ex.status === "shipped") {
      patch.delivered_at = now();
      patch.delivery_confirmed_by = "recipient";
    }
    await complete(
      c,
      ex,
      { type: "member", id: requesterId },
      "Recipient confirmed the book arrived as described",
      patch,
    );
  });
}

/** Staff record a delivery confirmed by the carrier or otherwise verified. Members can't. */
export async function markDeliveredByStaff(
  staffId: string,
  staffRole: string,
  exchangeId: string,
  source: "carrier" | "support",
  reason: string,
) {
  if (!can(staffRole, "exchanges.intervene")) throw new ForbiddenError();
  const why = requireReason(reason);
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.status !== "shipped") throw new DomainError("Only shipped exchanges can be marked delivered.");
    await markDelivered(c, ex, { type: "staff", id: staffId }, source, why);
    await audit(c, {
      actorId: staffId,
      action: "exchange.mark_delivered",
      targetType: "exchange",
      targetId: ex.id,
      reason: why,
      metadata: { source },
    });
  });
}
