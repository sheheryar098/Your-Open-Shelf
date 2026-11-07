"use server";

import { redirect } from "next/navigation";
import { run, str, type ActionState } from "@/shared/api/action";
import { enforceRateLimit } from "@/server/rate-limit";
import { actionUser, clientIp, currentUser } from "@/shared/api/session";
import { createTicket, fileReport, replyToTicket } from "@/server/domain/support";
import { DomainError } from "@/server/errors";

export async function createTicketAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const u = await currentUser();
    enforceRateLimit(`ticket:${u?.id ?? await clientIp()}`, 10, 60 * 60_000);
    if (str(fd, "website")) throw new DomainError("Something went wrong."); // honeypot for bots
    const id = await createTicket({
      userId: u?.id ?? null,
      contactEmail: str(fd, "email") || null,
      exchangeId: str(fd, "exchangeId") || null,
      category: str(fd, "category"),
      subject: str(fd, "subject"),
      body: str(fd, "body"),
    });
    if (u) redirect(`/support/${id}`);
    return `Thanks — we've received your message (reference #${id.slice(0, 8).toUpperCase()}) and will reply by email.`;
  });
}

export async function replyTicketAction(ticketId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    enforceRateLimit(`treply:${u.id}`, 30, 60 * 60_000);
    await replyToTicket(u, ticketId, str(fd, "body"), {
      internal: fd.get("internal") === "on",
      status: str(fd, "status") || null,
      priority: str(fd, "priority") || null,
      assignToMe: fd.get("assignToMe") === "on",
    });
    return "Saved.";
  });
}

export async function reportAction(targetType: "listing" | "member" | "review" | "message", targetId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    enforceRateLimit(`report:${u.id}`, 20, 24 * 60 * 60_000);
    await fileReport(u.id, targetType, targetId, str(fd, "reason"), str(fd, "details"));
    return "Thanks for letting us know. Our team will review this report.";
  });
}
