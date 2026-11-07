import { tx } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { policy } from "@/server/config";
import { addDays, now } from "@/server/clock";
import { can } from "@/server/rbac";
import { DISPUTE_TYPES } from "@/shared/lib/vocab";
import { refundForExchange } from "../credits";
import { notify } from "../notifications";
import { audit, requireReason } from "../audit";
import { saveUpload } from "../files";
import { type Actor, lockExchange, transition, bookTitle, setListingStatus, complete } from "./core";

export async function openDispute(
  userId: string,
  exchangeId: string,
  input: { issueType: string; description: string; evidence?: File | null },
) {
  if (!(input.issueType in DISPUTE_TYPES)) throw new DomainError("Choose what went wrong.");
  const description = input.description?.trim() ?? "";
  if (description.length < 20)
    throw new DomainError("Describe the problem in a little more detail (at least 20 characters).");
  return tx(async (c) => {
    const ex = await lockExchange(c, exchangeId);
    if (ex.requester_id !== userId && ex.sender_id !== userId) throw new ForbiddenError();
    if (ex.status !== "shipped" && ex.status !== "delivered") {
      throw new DomainError(
        ex.status === "disputed"
          ? "A dispute is already open for this exchange."
          : "Disputes can be opened once a book has shipped. For other problems, contact support.",
      );
    }
    const d = (
      await c.query<{ id: string }>(
        "INSERT INTO disputes (exchange_id, opened_by, issue_type, description) VALUES ($1, $2, $3, $4) RETURNING id",
        [ex.id, userId, input.issueType, description.slice(0, 4000)],
      )
    ).rows[0];
    let fileId: string | null = null;
    if (input.evidence && input.evidence.size > 0) fileId = await saveUpload(c, input.evidence, "evidence", userId);
    await c.query("INSERT INTO dispute_messages (dispute_id, author_id, body, file_id) VALUES ($1, $2, $3, $4)", [
      d.id,
      userId,
      description.slice(0, 4000),
      fileId,
    ]);
    // The completion path pauses while the case is reviewed.
    await transition(c, ex, "disputed", { type: "member", id: userId }, DISPUTE_TYPES[input.issueType], {
      status_before_dispute: ex.status,
    });
    const other = userId === ex.requester_id ? ex.sender_id : ex.requester_id;
    await notify(c, other, {
      type: "dispute",
      title: `A problem was reported on the exchange for “${await bookTitle(c, ex.listing_id)}”`,
      body: "YOS support will review the case. You can add information and evidence on the dispute page.",
      link: `/disputes/${d.id}`,
    });
    await notify(c, userId, {
      type: "dispute",
      title: "We've received your report",
      body: "Support will review the listing, tracking, messages and evidence, and may ask both members for more information.",
      link: `/disputes/${d.id}`,
    });
    return d.id;
  });
}

interface DisputeRow {
  id: string;
  exchange_id: string;
  opened_by: string;
  status: string;
}

export async function withdrawDispute(userId: string, disputeId: string) {
  await tx(async (c) => {
    const d = (await c.query<DisputeRow>("SELECT * FROM disputes WHERE id = $1 FOR UPDATE", [disputeId])).rows[0];
    if (!d) throw new NotFoundError("Dispute");
    if (d.opened_by !== userId) throw new ForbiddenError("Only the member who opened the dispute can withdraw it.");
    if (d.status === "resolved") throw new DomainError("This dispute is already resolved.");
    const ex = await lockExchange(c, d.exchange_id);
    const back = ex.status_before_dispute ?? "shipped";
    const t = now();
    const patch: Record<string, unknown> = { status_before_dispute: null };
    if (back === "delivered") patch.completion_due_at = addDays(t, policy.disputeWindowDays);
    if (back === "shipped" && ex.auto_confirm_at && ex.auto_confirm_at < t) patch.auto_confirm_at = addDays(t, 1);
    await transition(c, ex, back, { type: "member", id: userId }, "Dispute withdrawn", patch);
    await c.query(
      `UPDATE disputes SET status = 'resolved', decision_reason = 'Withdrawn by the member who opened it',
        decided_at = $2, updated_at = now()
        WHERE id = $1`,
      [d.id, t],
    );
    const other = userId === ex.requester_id ? ex.sender_id : ex.requester_id;
    await notify(c, other, {
      type: "dispute",
      title: "A dispute on your exchange was withdrawn",
      link: `/exchanges/${ex.id}`,
    });
  });
}

export async function resolveDispute(
  staffId: string,
  staffRole: string,
  disputeId: string,
  outcome: "release_to_sender" | "refund_requester",
  reason: string,
) {
  if (!can(staffRole, "disputes.manage")) throw new ForbiddenError();
  const why = requireReason(reason, 10);
  await tx(async (c) => {
    const d = (await c.query<DisputeRow>("SELECT * FROM disputes WHERE id = $1 FOR UPDATE", [disputeId])).rows[0];
    if (!d) throw new NotFoundError("Dispute");
    if (d.status === "resolved") throw new DomainError("This dispute is already resolved.");
    const ex = await lockExchange(c, d.exchange_id);
    if (ex.status !== "disputed") throw new DomainError("The exchange isn't in a disputed state.");
    const actor: Actor = { type: "staff", id: staffId };
    if (outcome === "release_to_sender") {
      await complete(c, ex, actor, `Dispute resolved: credit released to sender. ${why}`);
    } else {
      await transition(c, ex, "refunded", actor, `Dispute resolved: credit restored to requester. ${why}`, {
        closed_at: now(),
        close_reason: why,
      });
      await refundForExchange(
        c,
        ex.requester_id,
        ex.id,
        ex.credit_cost,
        `Dispute resolved in your favour, ${why}`,
        staffId,
      );
      await setListingStatus(c, ex.listing_id, "unavailable", "Closed after a dispute");
    }
    await c.query(
      `UPDATE disputes SET status = 'resolved', outcome = $2, decision_reason = $3, decided_by = $4, decided_at = $5, updated_at = now()
        WHERE id = $1`,
      [d.id, outcome, why, staffId, now()],
    );
    await audit(c, {
      actorId: staffId,
      action: "dispute.resolve",
      targetType: "dispute",
      targetId: d.id,
      reason: why,
      metadata: { outcome, exchangeId: ex.id },
    });
    const title = await bookTitle(c, ex.listing_id);
    const body = `Decision: ${outcome === "release_to_sender" ? "the exchange is complete and the sender receives the credit" : "the requester's credit has been restored"}. Reason: ${why}\n\nIf you disagree, you can appeal by opening a support ticket within 14 days.`;
    for (const uid of [ex.requester_id, ex.sender_id]) {
      await notify(c, uid, {
        type: "dispute",
        title: `Decision on the dispute for “${title}”`,
        body,
        link: `/disputes/${d.id}`,
      });
    }
  });
}

export async function addDisputeMessage(
  user: { id: string; role: string },
  disputeId: string,
  body: string,
  opts: { file?: File | null; internal?: boolean; status?: "awaiting_info" | "under_review" | null } = {},
) {
  const text = body?.trim();
  if (!text) throw new DomainError("Write a message.");
  const staff = can(user.role, "disputes.manage");
  await tx(async (c) => {
    const d = (
      await c.query<DisputeRow & { requester_id: string; sender_id: string }>(
        `SELECT d.*, e.requester_id, e.sender_id
           FROM disputes d
           JOIN exchanges e ON e.id = d.exchange_id
          WHERE d.id = $1 FOR UPDATE OF d`,
        [disputeId],
      )
    ).rows[0];
    if (!d) throw new NotFoundError("Dispute");
    const party = d.requester_id === user.id || d.sender_id === user.id;
    if (!party && !staff) throw new ForbiddenError();
    if (d.status === "resolved") throw new DomainError("This dispute is resolved. Open a support ticket to appeal.");
    let fileId: string | null = null;
    if (opts.file && opts.file.size > 0) fileId = await saveUpload(c, opts.file, "evidence", user.id);
    const internal = staff && !!opts.internal;
    await c.query(
      "INSERT INTO dispute_messages (dispute_id, author_id, body, file_id, internal) VALUES ($1, $2, $3, $4, $5)",
      [d.id, user.id, text.slice(0, 4000), fileId, internal],
    );
    const nextStatus =
      staff && opts.status ? opts.status : party && d.status === "awaiting_info" ? "under_review" : null;
    if (nextStatus)
      await c.query("UPDATE disputes SET status = $2, updated_at = now() WHERE id = $1", [d.id, nextStatus]);
    if (staff && !d.status.includes("review") && !opts.status) {
      await c.query(
        `UPDATE disputes SET status = 'under_review', assigned_to = coalesce(assigned_to, $2), updated_at = now()
          WHERE id = $1 AND status = 'open'`,
        [d.id, user.id],
      );
    }
    if (!internal) {
      const recipients = staff
        ? [d.requester_id, d.sender_id]
        : [d.requester_id, d.sender_id].filter((u) => u !== user.id);
      for (const uid of recipients) {
        await notify(c, uid, {
          type: "dispute",
          title: staff
            ? opts.status === "awaiting_info"
              ? "Support needs more information about your dispute"
              : "Support replied on your dispute"
            : "New message on a dispute",
          link: `/disputes/${d.id}`,
        });
      }
    }
  });
}
