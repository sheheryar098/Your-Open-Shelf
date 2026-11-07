"use server";

import { redirect } from "next/navigation";
import { bool, file, run, str, type ActionState } from "@/shared/api/action";
import { enforceRateLimit } from "@/server/rate-limit";
import { actionUser } from "@/shared/api/session";
import { acceptRequest, cancelRequest, declineRequest, senderCancel } from "@/server/domain/exchanges/response";
import { addDisputeMessage, openDispute, withdrawDispute } from "@/server/domain/exchanges/disputes";
import { confirmReceipt } from "@/server/domain/exchanges/completion";
import { leaveReview, postMessage } from "@/server/domain/exchanges/conversation";
import { markShipped } from "@/server/domain/exchanges/shipping";
import { requestBook } from "@/server/domain/exchanges/request";

export async function requestBookAction(listingId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    enforceRateLimit(
      `request:${u.id}`,
      15,
      60 * 60_000,
      "You've made a lot of requests recently. Please try again later.",
    );
    const id = await requestBook({
      requesterId: u.id,
      listingId,
      addressId: str(fd, "addressId"),
      requestKey: str(fd, "requestKey"),
    });
    redirect(`/exchanges/${id}?requested=1`);
  });
}

export async function acceptAction(id: string, _: ActionState) {
  return run(async () => {
    const u = await actionUser();
    await acceptRequest(u.id, id);
    return "Request accepted. The delivery address is now shown below, please dispatch within the deadline.";
  });
}

export async function declineAction(id: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    await declineRequest(u.id, id, str(fd, "reason"), bool(fd, "noLongerAvailable"));
    return "Request declined. The requester's credit has been returned.";
  });
}

export async function cancelRequestAction(id: string, _: ActionState) {
  return run(async () => {
    const u = await actionUser();
    await cancelRequest(u.id, id);
    return "Request cancelled and your credit returned.";
  });
}

export async function senderCancelAction(id: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    await senderCancel(u.id, id, str(fd, "reason"));
    return "Exchange cancelled. The requester's credit has been returned.";
  });
}

export async function shipAction(id: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    await markShipped(u.id, id, {
      carrier: str(fd, "carrier"),
      trackingNumber: str(fd, "trackingNumber") || null,
      trackingUrl: str(fd, "trackingUrl") || null,
      dispatchDate: str(fd, "dispatchDate"),
      proof: file(fd, "proof"),
    });
    return "Marked as shipped. You'll earn your credit once the exchange completes.";
  });
}

export async function confirmReceiptAction(id: string, _: ActionState) {
  return run(async () => {
    const u = await actionUser();
    await confirmReceipt(u.id, id);
    return "Thanks for confirming! The exchange is complete.";
  });
}

export async function openDisputeAction(id: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    enforceRateLimit(`dispute:${u.id}`, 5, 24 * 60 * 60_000);
    const d = await openDispute(u.id, id, {
      issueType: str(fd, "issueType"),
      description: str(fd, "description"),
      evidence: file(fd, "evidence"),
    });
    redirect(`/disputes/${d}`);
  });
}

export async function disputeMessageAction(disputeId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    enforceRateLimit(`dmsg:${u.id}`, 30, 60 * 60_000);
    const status = str(fd, "status");
    await addDisputeMessage(u, disputeId, str(fd, "body"), {
      file: file(fd, "file"),
      internal: bool(fd, "internal"),
      status: status === "awaiting_info" || status === "under_review" ? status : null,
    });
    return "Added to the case.";
  });
}

export async function withdrawDisputeAction(disputeId: string, _: ActionState) {
  return run(async () => {
    const u = await actionUser();
    await withdrawDispute(u.id, disputeId);
    return "Dispute withdrawn. The exchange continues as normal.";
  });
}

export async function messageAction(id: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    enforceRateLimit(`msg:${u.id}`, 40, 60 * 60_000, "You're sending messages too quickly.");
    await postMessage(u.id, id, str(fd, "body"));
  });
}

export async function reviewAction(id: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    await leaveReview(u.id, id, {
      rating: Number(str(fd, "rating")),
      tags: fd.getAll("tags").map(String),
      comment: str(fd, "comment") || null,
    });
    return "Thanks for your feedback.";
  });
}
