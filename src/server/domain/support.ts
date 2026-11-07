import { z } from "zod";
import { query, queryOne, tx } from "@/server/db";
import { DomainError, ForbiddenError, NotFoundError } from "@/server/errors";
import { can } from "@/server/rbac";
import { HIGH_PRIORITY_CATEGORIES, REPORT_REASONS, TICKET_CATEGORIES } from "@/shared/lib/vocab";
import { isCountryCode, addressLabels } from "@/shared/lib/countries";
import { notify, queueEmail } from "./notifications";
import { audit, requireReason } from "./audit";
import { isUuid } from "@/shared/lib/ids";

// ---------------------------------------------------------------------------
// Addresses (private to their owner)
// ---------------------------------------------------------------------------

export const addressSchema = z.object({
  label: z.string().trim().max(40).optional().default(""),
  recipientName: z.string().trim().min(2, "Enter the recipient's name.").max(100),
  line1: z.string().trim().min(3, "Enter the street address.").max(200),
  line2: z.string().trim().max(200).optional().default(""),
  city: z.string().trim().min(1, "Enter the city or locality.").max(100),
  region: z.string().trim().max(100).optional().default(""),
  postalCode: z.string().trim().max(20).optional().default(""),
  country: z.string().refine(isCountryCode, "Choose a country."),
  phone: z.string().trim().max(30).optional().default(""),
  isDefault: z.boolean().default(false),
});

export async function saveAddress(userId: string, a: z.infer<typeof addressSchema>, id?: string) {
  const labels = addressLabels(a.country);
  if (labels.postalRequired && !a.postalCode) throw new DomainError(`Enter the ${labels.postal.toLowerCase()}.`);
  if (labels.regionRequired && !a.region) throw new DomainError(`Enter the ${labels.region.toLowerCase()}.`);
  return tx(async (c) => {
    const count = Number(
      (
        await c.query<{ n: string }>("SELECT count(*) AS n FROM addresses WHERE user_id = $1 AND deleted_at IS NULL", [
          userId,
        ])
      ).rows[0].n,
    );
    if (!id && count >= 10) throw new DomainError("You can save up to 10 addresses.");
    const makeDefault = a.isDefault || count === 0;
    if (makeDefault) await c.query("UPDATE addresses SET is_default = false WHERE user_id = $1", [userId]);
    const vals = [
      a.label || null,
      a.recipientName,
      a.line1,
      a.line2 || null,
      a.city,
      a.region || null,
      a.postalCode || null,
      a.country.toUpperCase(),
      a.phone || null,
      makeDefault,
    ];
    if (id) {
      const r = await c.query(
        `UPDATE addresses SET label=$3, recipient_name=$4, line1=$5, line2=$6, city=$7, region=$8,
          postal_code=$9, country_code=$10, phone=$11,
           is_default = $12 OR is_default
          WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [id, userId, ...vals],
      );
      if (!r.rowCount) throw new NotFoundError("Address");
      return id;
    }
    return (
      await c.query<{ id: string }>(
        `INSERT INTO addresses (user_id, label, recipient_name, line1, line2, city, region, postal_code, country_code, phone, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [userId, ...vals],
      )
    ).rows[0].id;
  });
}

export async function deleteAddress(userId: string, id: string) {
  await query("UPDATE addresses SET deleted_at = now(), is_default = false WHERE id = $1 AND user_id = $2", [
    id,
    userId,
  ]);
}

export interface Address {
  id: string;
  label: string | null;
  recipient_name: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  phone: string | null;
  is_default: boolean;
}

export async function addressesFor(userId: string) {
  return query<Address>(
    "SELECT * FROM addresses WHERE user_id = $1 AND deleted_at IS NULL ORDER BY is_default DESC, created_at",
    [userId],
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export async function fileReport(
  reporterId: string,
  targetType: "listing" | "member" | "review" | "message",
  targetId: string,
  reason: string,
  details: string,
) {
  if (!(reason in REPORT_REASONS)) throw new DomainError("Choose a reason.");
  if (!isUuid(targetId)) throw new DomainError("Invalid report target.");
  const table = { listing: "listings", member: "users", review: "reviews", message: "messages" }[targetType];
  const exists = await queryOne(`SELECT 1 FROM ${table} WHERE id = $1`, [targetId]);
  if (!exists) throw new NotFoundError("Reported item");
  const dup = await queryOne("SELECT 1 FROM reports WHERE reporter_id = $1 AND target_id = $2 AND status = 'open'", [
    reporterId,
    targetId,
  ]);
  if (dup) throw new DomainError("You've already reported this. Our team will review it.");
  await query(
    "INSERT INTO reports (reporter_id, target_type, target_id, reason, details) VALUES ($1, $2, $3, $4, $5)",
    [reporterId, targetType, targetId, reason, details?.trim().slice(0, 2000) || null],
  );
}

export async function handleReport(
  staffId: string,
  staffRole: string,
  reportId: string,
  status: "actioned" | "dismissed",
  note: string,
) {
  if (!can(staffRole, "reports.manage")) throw new ForbiddenError();
  const why = requireReason(note);
  await tx(async (c) => {
    const r = (
      await c.query<{ id: string; status: string; reporter_id: string; target_type: string; target_id: string }>(
        "SELECT * FROM reports WHERE id = $1 FOR UPDATE",
        [reportId],
      )
    ).rows[0];
    if (!r) throw new NotFoundError("Report");
    if (r.status !== "open") throw new DomainError("This report has already been handled.");
    await c.query(
      "UPDATE reports SET status = $2, handled_by = $3, handled_at = now(), resolution_note = $4 WHERE id = $1",
      [reportId, status, staffId, why],
    );
    await audit(c, {
      actorId: staffId,
      action: `report.${status}`,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: why,
      metadata: { reportId },
    });
    await notify(c, r.reporter_id, {
      type: "support",
      title: "Thanks for your report",
      body: "Our team has reviewed it. We don't share the details of actions taken on other members' accounts.",
      email: false,
    });
  });
}

export async function hideReview(staffId: string, reviewId: string, reason: string) {
  const why = requireReason(reason);
  await tx(async (c) => {
    await c.query("UPDATE reviews SET hidden_at = now(), hidden_reason = $2 WHERE id = $1", [reviewId, why]);
    await audit(c, { actorId: staffId, action: "review.hide", targetType: "review", targetId: reviewId, reason: why });
  });
}

export async function hideMessage(staffId: string, messageId: string, reason: string) {
  const why = requireReason(reason);
  await tx(async (c) => {
    await c.query("UPDATE messages SET hidden_at = now() WHERE id = $1", [messageId]);
    await audit(c, {
      actorId: staffId,
      action: "message.hide",
      targetType: "message",
      targetId: messageId,
      reason: why,
    });
  });
}

// ---------------------------------------------------------------------------
// Support tickets
// ---------------------------------------------------------------------------

export async function createTicket(input: {
  userId?: string | null;
  contactEmail?: string | null;
  exchangeId?: string | null;
  category: string;
  subject: string;
  body: string;
}) {
  if (!(input.category in TICKET_CATEGORIES)) throw new DomainError("Choose a category.");
  const subject = input.subject?.trim();
  const body = input.body?.trim();
  if (!subject || subject.length < 4) throw new DomainError("Add a short subject.");
  if (!body || body.length < 10) throw new DomainError("Tell us a bit more about the problem.");
  if (!input.userId) {
    const email = z.string().email().safeParse(input.contactEmail?.trim());
    if (!email.success) throw new DomainError("Enter an email address so we can reply.");
  }
  if (input.exchangeId && input.userId) {
    const party = await queryOne("SELECT 1 FROM exchanges WHERE id = $1 AND (requester_id = $2 OR sender_id = $2)", [
      input.exchangeId,
      input.userId,
    ]);
    if (!party) throw new DomainError("That exchange isn't on your account.");
  }
  const priority = HIGH_PRIORITY_CATEGORIES.has(input.category) ? "high" : "normal";
  return tx(async (c) => {
    const t = (
      await c.query<{ id: string }>(
        `INSERT INTO support_tickets (user_id, contact_email, exchange_id, category, subject, priority)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          input.userId ?? null,
          input.userId ? null : input.contactEmail!.trim(),
          input.exchangeId || null,
          input.category,
          subject.slice(0, 200),
          priority,
        ],
      )
    ).rows[0];
    await c.query("INSERT INTO ticket_messages (ticket_id, author_id, body) VALUES ($1, $2, $3)", [
      t.id,
      input.userId ?? null,
      body.slice(0, 5000),
    ]);
    const ref = t.id.slice(0, 8).toUpperCase();
    if (input.userId) {
      await notify(c, input.userId, {
        type: "support",
        title: `We've received your request (#${ref})`,
        body: "We aim to acknowledge standard tickets within 1 business day.",
        link: `/support/${t.id}`,
      });
    } else {
      await queueEmail(
        c,
        input.contactEmail!.trim(),
        `We've received your request (#${ref})`,
        `Thanks for contacting YOS. We aim to reply within 1 business day.\n\nSubject: ${subject}`,
      );
    }
    return t.id;
  });
}

export async function replyToTicket(
  user: { id: string; role: string },
  ticketId: string,
  body: string,
  opts: { internal?: boolean; status?: string | null; priority?: string | null; assignToMe?: boolean } = {},
) {
  const text = body?.trim();
  const staff = can(user.role, "support.manage");
  await tx(async (c) => {
    const t = (
      await c.query<{
        id: string;
        user_id: string | null;
        contact_email: string | null;
        status: string;
        subject: string;
      }>("SELECT * FROM support_tickets WHERE id = $1 FOR UPDATE", [ticketId])
    ).rows[0];
    if (!t) throw new NotFoundError("Ticket");
    if (!staff && t.user_id !== user.id) throw new ForbiddenError();
    if (text) {
      await c.query("INSERT INTO ticket_messages (ticket_id, author_id, body, internal) VALUES ($1, $2, $3, $4)", [
        t.id,
        user.id,
        text.slice(0, 5000),
        staff && !!opts.internal,
      ]);
    } else if (!staff || (!opts.status && !opts.priority && !opts.assignToMe)) {
      throw new DomainError("Write a message.");
    }
    if (staff) {
      const status =
        opts.status && ["open", "awaiting_member", "in_progress", "resolved", "closed"].includes(opts.status)
          ? opts.status
          : text && !opts.internal
            ? "awaiting_member"
            : t.status;
      const priority =
        opts.priority && ["low", "normal", "high", "urgent"].includes(opts.priority) ? opts.priority : null;
      await c.query(
        `UPDATE support_tickets SET status = $2, priority = coalesce($3, priority),
           assigned_to = CASE WHEN $4 THEN $5::uuid ELSE assigned_to END, updated_at = now() WHERE id = $1`,
        [t.id, status, priority, !!opts.assignToMe, user.id],
      );
      if (text && !opts.internal) {
        if (t.user_id) {
          await notify(c, t.user_id, {
            type: "support",
            title: `Support replied: ${t.subject}`,
            body: text.slice(0, 300),
            link: `/support/${t.id}`,
          });
        } else if (t.contact_email) {
          await queueEmail(c, t.contact_email, `Re: ${t.subject}`, text);
        }
      }
    } else {
      const reopen = ["awaiting_member", "resolved"].includes(t.status) ? "open" : t.status;
      if (t.status === "closed") throw new DomainError("This ticket is closed. Please open a new one.");
      await c.query("UPDATE support_tickets SET status = $2, updated_at = now() WHERE id = $1", [t.id, reopen]);
    }
  });
}

export async function getTicketForViewer(id: string, viewer: { id: string; role: string }) {
  const t = await queryOne<{
    id: string;
    user_id: string | null;
    contact_email: string | null;
    exchange_id: string | null;
    category: string;
    subject: string;
    status: string;
    priority: string;
    assigned_to: string | null;
    created_at: Date;
    updated_at: Date;
    member_name: string | null;
    assignee_name: string | null;
  }>(
    `SELECT t.*, u.display_name AS member_name, a.display_name AS assignee_name FROM support_tickets t
       LEFT JOIN users u ON u.id = t.user_id LEFT JOIN users a ON a.id = t.assigned_to WHERE t.id = $1`,
    [id],
  );
  if (!t) return null;
  const staff = can(viewer.role, "support.manage");
  if (!staff && t.user_id !== viewer.id) return null;
  const messages = await query<{
    id: string;
    author_id: string | null;
    author_name: string | null;
    author_role: string | null;
    body: string;
    internal: boolean;
    created_at: Date;
  }>(
    `SELECT m.id, m.author_id, u.display_name AS author_name, u.role AS author_role, m.body, m.internal, m.created_at
       FROM ticket_messages m LEFT JOIN users u ON u.id = m.author_id
      WHERE m.ticket_id = $1 AND (NOT m.internal OR $2) ORDER BY m.created_at`,
    [id, staff],
  );
  return { ticket: t, messages, staff };
}

export async function ticketsFor(userId: string) {
  return query<{ id: string; subject: string; category: string; status: string; updated_at: Date }>(
    "SELECT id, subject, category, status, updated_at FROM support_tickets WHERE user_id = $1 ORDER BY updated_at DESC",
    [userId],
  );
}

// ---------------------------------------------------------------------------
// Public profile and reviews
// ---------------------------------------------------------------------------

export async function publicProfile(userId: string) {
  const u = await queryOne<{
    id: string;
    display_name: string;
    bio: string | null;
    country_code: string | null;
    created_at: Date;
    status: string;
    avatar_file_id: string | null;
  }>("SELECT id, display_name, bio, country_code, created_at, status, avatar_file_id FROM users WHERE id = $1", [
    userId,
  ]);
  if (!u || u.status === "closed") return null;
  const stats = await queryOne<{ completed: string; avg_rating: string | null; review_count: string }>(
    `SELECT (SELECT count(*) FROM exchanges WHERE (sender_id = $1 OR requester_id = $1) AND status = 'completed') AS completed,
            (SELECT avg(rating) FROM reviews WHERE reviewee_id = $1 AND hidden_at IS NULL) AS avg_rating,
            (SELECT count(*) FROM reviews WHERE reviewee_id = $1 AND hidden_at IS NULL) AS review_count`,
    [userId],
  );
  const reviews = await query<{
    id: string;
    rating: number;
    tags: string[];
    comment: string | null;
    created_at: Date;
    reviewer_name: string;
  }>(
    `SELECT r.id, r.rating, r.tags, r.comment, r.created_at, u.display_name AS reviewer_name
       FROM reviews r JOIN users u ON u.id = r.reviewer_id WHERE r.reviewee_id = $1 AND r.hidden_at IS NULL
      ORDER BY r.created_at DESC LIMIT 20`,
    [userId],
  );
  return {
    user: u,
    completed: Number(stats?.completed ?? 0),
    avgRating: stats?.avg_rating ? Number(stats.avg_rating) : null,
    reviewCount: Number(stats?.review_count ?? 0),
    reviews,
  };
}
