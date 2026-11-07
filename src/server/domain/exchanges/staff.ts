import { tx } from "@/server/db";
import { DomainError, ForbiddenError } from "@/server/errors";
import { now } from "@/server/clock";
import { can } from "@/server/rbac";
import { releaseForExchange } from "../credits";
import { notify } from "../notifications";
import { audit, requireReason } from "../audit";
import { lockExchange, recordEvent, reopenListing, transition } from "./core";

export async function staffCancel(staffId: string, staffRole: string, exchangeId: string, reason: string) {
  if (!can(staffRole, "exchanges.intervene")) throw new ForbiddenError();
  const why = requireReason(reason);
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.status !== "requested" && ex.status !== "accepted") {
      throw new DomainError(
        "Only exchanges that haven't shipped can be cancelled. Use the dispute process for shipped books.",
      );
    }
    await transition(c, ex, "cancelled", { type: "staff", id: staffId }, why, {
      closed_at: now(),
      cancel_kind: "support_cancelled",
      close_reason: why,
    });
    await releaseForExchange(
      c,
      ex.requester_id,
      ex.id,
      ex.credit_cost,
      "Exchange cancelled by YOS support, credit returned",
    );
    await reopenListing(c, ex.listing_id);
    await audit(c, {
      actorId: staffId,
      action: "exchange.cancel",
      targetType: "exchange",
      targetId: ex.id,
      reason: why,
    });
    for (const uid of [ex.requester_id, ex.sender_id]) {
      await notify(c, uid, {
        type: "request_cancelled",
        title: "An exchange was cancelled by YOS support",
        body: `Reason: ${why}`,
        link: `/exchanges/${ex.id}`,
      });
    }
  });
}

/** Extends the running deadline, e.g. for holidays or carrier disruption. */
export async function extendDeadline(
  staffId: string,
  staffRole: string,
  exchangeId: string,
  days: number,
  reason: string,
) {
  if (!can(staffRole, "exchanges.intervene")) throw new ForbiddenError();
  const why = requireReason(reason);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new DomainError("Extend by 1–30 days.");
  await tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    const col =
      ex.status === "requested"
        ? "respond_by"
        : ex.status === "accepted"
          ? "dispatch_by"
          : ex.status === "shipped"
            ? "auto_confirm_at"
            : ex.status === "delivered"
              ? "completion_due_at"
              : null;
    if (!col) throw new DomainError("There's no running deadline to extend.");
    await c.query(
      `UPDATE exchanges SET ${col} = coalesce(${col}, $2) + make_interval(days => $3), updated_at = now()
        WHERE id = $1`,
      [ex.id, now(), days],
    );
    await recordEvent(
      c,
      ex.id,
      ex.status,
      ex.status,
      { type: "staff", id: staffId },
      `Deadline extended by ${days} days: ${why}`,
    );
    await audit(c, {
      actorId: staffId,
      action: "exchange.extend_deadline",
      targetType: "exchange",
      targetId: ex.id,
      reason: why,
      metadata: { days, column: col },
    });
  });
}
