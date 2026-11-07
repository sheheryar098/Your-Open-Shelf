"use server";

import { randomUUID } from "node:crypto";
import { bool, run, str, type ActionState } from "@/shared/api/action";
import { DomainError } from "@/server/errors";
import { actionStaff } from "@/shared/api/session";
import { isCountryCode } from "@/shared/lib/countries";
import { adminAdjust, reverseEntry } from "@/server/domain/credits";
import { setAccountStatus, setRestrictions, setRole } from "@/server/domain/users";
import { moderateListing } from "@/server/domain/listings";
import { correctCatalogRecord } from "@/server/domain/catalog";
import { createAnnouncement, setAnnouncementActive } from "@/server/domain/announcements";
import { extendDeadline, staffCancel } from "@/server/domain/exchanges/staff";
import { markDeliveredByStaff } from "@/server/domain/exchanges/completion";
import { resolveDispute } from "@/server/domain/exchanges/disputes";
import { handleReport, hideMessage, hideReview } from "@/server/domain/support";
import { getRoute, updateCountry, upsertRoute, type ShippingRoute } from "@/server/domain/routes";
import { requireReason } from "@/server/domain/audit";
import { requeueDeadEmail, resolveParkedItem, runJobs } from "@/server/jobs/runner";

export async function adjustCreditsAction(userId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const admin = await actionStaff("credits.adjust");
    const amount = Number(str(fd, "amount"));
    await adminAdjust({
      adminId: admin.id,
      userId,
      amount,
      reason: str(fd, "reason"),
      idempotencyKey: str(fd, "idempotencyKey") || randomUUID(),
      exchangeId: str(fd, "exchangeId") || null,
    });
    return `Adjustment of ${amount > 0 ? "+" : ""}${amount} recorded.`;
  });
}

export async function reverseLedgerAction(ledgerId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const admin = await actionStaff("credits.adjust");
    await reverseEntry({ adminId: admin.id, ledgerId, reason: str(fd, "reason") });
    return "Entry reversed.";
  });
}

export async function restrictMemberAction(userId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const staff = await actionStaff("members.restrict");
    await setRestrictions(
      staff.id,
      userId,
      { canList: bool(fd, "canList"), canRequest: bool(fd, "canRequest") },
      str(fd, "reason"),
    );
    return "Restrictions updated.";
  });
}

export async function accountStatusAction(
  userId: string,
  status: "active" | "suspended",
  _: ActionState,
  fd: FormData,
) {
  return run(async () => {
    const staff = await actionStaff("members.suspend");
    await setAccountStatus(staff.id, userId, status, str(fd, "reason"));
    return status === "suspended" ? "Account suspended." : "Account reinstated.";
  });
}

export async function roleAction(userId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const admin = await actionStaff("members.roles");
    const role = str(fd, "role");
    if (!["member", "moderator", "admin"].includes(role)) throw new DomainError("Unknown role.");
    await setRole(admin.id, userId, role as "member", str(fd, "reason"));
    return "Role updated.";
  });
}

export async function moderateListingAction(listingId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const staff = await actionStaff("listings.moderate");
    const status = str(fd, "status");
    if (!["removed", "under_review", "active", "paused"].includes(status)) throw new DomainError("Choose an action.");
    await moderateListing(staff.id, listingId, status as "removed", str(fd, "reason"));
    return "Listing updated.";
  });
}

export async function editBookAction(bookId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const staff = await actionStaff("listings.moderate");
    await correctCatalogRecord(
      staff.id,
      bookId,
      {
        isbn: str(fd, "isbn") || null,
        title: str(fd, "title"),
        authors: str(fd, "authors")
          .split(/[,;]/)
          .map((a) => a.trim())
          .filter(Boolean),
        publisher: str(fd, "publisher") || null,
        publicationYear: Number(str(fd, "year")) || null,
        edition: str(fd, "edition") || null,
      },
      str(fd, "reason"),
    );
    return "Catalog record corrected.";
  });
}

export async function resolveDisputeAction(disputeId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const staff = await actionStaff("disputes.manage");
    const outcome = str(fd, "outcome");
    if (outcome !== "release_to_sender" && outcome !== "refund_requester") throw new DomainError("Choose an outcome.");
    await resolveDispute(staff.id, staff.role, disputeId, outcome, str(fd, "reason"));
    return "Decision recorded and both members notified.";
  });
}

export async function exchangeInterventionAction(exchangeId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const staff = await actionStaff("exchanges.intervene");
    const op = str(fd, "op");
    const reason = str(fd, "reason");
    if (op === "cancel") await staffCancel(staff.id, staff.role, exchangeId, reason);
    else if (op === "delivered_carrier")
      await markDeliveredByStaff(staff.id, staff.role, exchangeId, "carrier", reason);
    else if (op === "delivered_support")
      await markDeliveredByStaff(staff.id, staff.role, exchangeId, "support", reason);
    else if (op === "extend") await extendDeadline(staff.id, staff.role, exchangeId, Number(str(fd, "days")), reason);
    else throw new DomainError("Choose an action.");
    return "Done.";
  });
}

export async function handleReportAction(reportId: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const staff = await actionStaff("reports.manage");
    const status = str(fd, "status") === "actioned" ? "actioned" : "dismissed";
    const note = str(fd, "note");
    const targetType = str(fd, "targetType");
    const targetId = str(fd, "targetId");
    if (status === "actioned" && bool(fd, "hideTarget")) {
      if (targetType === "review") await hideReview(staff.id, targetId, note);
      if (targetType === "message") await hideMessage(staff.id, targetId, note);
      if (targetType === "listing") await moderateListing(staff.id, targetId, "under_review", note);
    }
    await handleReport(staff.id, staff.role, reportId, status, note);
    return "Report closed.";
  });
}

export async function countryAction(code: string, _: ActionState, fd: FormData) {
  return run(async () => {
    const admin = await actionStaff("routes.manage");
    const status = str(fd, "status");
    if (!["open", "limited", "waitlist", "unavailable"].includes(status)) throw new DomainError("Choose a status.");
    await updateCountry(
      admin.id,
      code,
      {
        status: status as "open",
        status_note: str(fd, "statusNote") || null,
        prohibited_items_notice: str(fd, "prohibited") || null,
        currency: str(fd, "currency").toUpperCase() || null,
      },
      str(fd, "reason"),
    );
    return "Country updated.";
  });
}

export async function routeAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const admin = await actionStaff("routes.manage");
    const origin = str(fd, "origin").toUpperCase();
    const destination = str(fd, "destination").toUpperCase();
    if (!isCountryCode(origin) || !isCountryCode(destination)) throw new DomainError("Choose both countries.");
    const num = (k: string) => (str(fd, k) === "" ? null : Number(str(fd, k)));
    const prev = await getRoute(origin, destination);
    const r: Omit<ShippingRoute, "id"> = {
      origin_country: origin,
      destination_country: destination,
      enabled: bool(fd, "enabled"),
      tracking_available: bool(fd, "trackingAvailable"),
      tracking_required: bool(fd, "trackingRequired"),
      carrier_guidance: str(fd, "carrierGuidance") || null,
      min_delivery_days: num("minDays"),
      max_delivery_days: num("maxDays"),
      postage_estimate_min: str(fd, "postageMin") || null,
      postage_estimate_max: str(fd, "postageMax") || null,
      postage_currency: str(fd, "postageCurrency").toUpperCase() || null,
      max_weight_grams: num("maxWeight"),
      customs_required: bool(fd, "customsRequired"),
      customs_notice: str(fd, "customsNotice") || null,
      restricted_content_notes: str(fd, "restricted") || null,
      risk_level: (["low", "medium", "high"].includes(str(fd, "risk")) ? str(fd, "risk") : "low") as "low",
      support_notes: str(fd, "supportNotes") || null,
    };
    await upsertRoute(admin.id, r, str(fd, "reason"));
    return prev ? "Route updated." : "Route created.";
  });
}

export async function announcementAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const admin = await actionStaff("content.manage");
    await createAnnouncement(admin.id, str(fd, "message"), str(fd, "level") === "warning" ? "warning" : "info");
    return "Announcement published.";
  });
}

export async function toggleAnnouncementAction(id: string, active: boolean, _: ActionState) {
  return run(async () => {
    const admin = await actionStaff("content.manage");
    await setAnnouncementActive(admin.id, id, active);
    return active ? "Announcement shown." : "Announcement hidden.";
  });
}

export async function runJobsAction(_: ActionState) {
  return run(async () => {
    await actionStaff("exchanges.intervene");
    const r = await runJobs();
    const processed = Object.values(r).reduce((a, j) => a + j.processed, 0);
    const failed = Object.values(r).reduce((a, j) => a + j.failed, 0);
    return `Jobs ran: ${processed} item(s) processed${failed ? `, ${failed} failed (see below)` : ""}.`;
  });
}

export async function parkedItemAction(id: string, action: "retry" | "dismiss", _: ActionState, fd: FormData) {
  return run(async () => {
    const staff = await actionStaff("exchanges.intervene");
    const note = action === "dismiss" ? requireReason(str(fd, "note")) : "retry requested";
    await resolveParkedItem(staff.id, id, action, note);
    return action === "retry" ? "The item will be retried on the next run." : "Marked as handled.";
  });
}

export async function requeueEmailAction(id: string, _: ActionState) {
  return run(async () => {
    const staff = await actionStaff("exchanges.intervene");
    await requeueDeadEmail(staff.id, id);
    return "Email re-queued.";
  });
}
