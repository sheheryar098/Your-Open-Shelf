import { randomUUID } from "node:crypto";
import { pool, tx } from "@/server/db";
import { setNow } from "@/server/clock";
import { hashPassword } from "@/server/auth/password";
import { seedReferenceData } from "../scripts/reference-data";
import { placeholderPng } from "../scripts/png";
import { saveBuffer } from "@/server/domain/files";
import { createListing, publishListing } from "@/server/domain/listings";
import { adminAdjust } from "@/server/domain/credits";
import { saveAddress } from "@/server/domain/support";

let passwordHash: string | null = null;

export async function resetData() {
  setNow(null);
  await pool().query(`TRUNCATE users, sessions, email_tokens, files, addresses, books, listings, listing_photos, exchanges,
    exchange_addresses, exchange_events, shipments, messages, credit_accounts, credit_ledger, wishlist_items, reviews,
    notifications, email_outbox, disputes, dispute_messages, reports, support_tickets, ticket_messages, admin_audit_logs,
    announcements, job_runs, job_failures, cache_entries, cache_metrics, shipping_routes, countries CASCADE`);
  await seedReferenceData(pool());
}

export async function makeUser(opts: { country?: string; role?: string; credits?: number; scope?: "domestic" | "international"; verified?: boolean; name?: string } = {}) {
  passwordHash ??= await hashPassword("test-password-123");
  const country = opts.country ?? "GB";
  const r = await pool().query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, role, country_code, email_verified_at, ship_scope)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [`${randomUUID()}@test.yos`, passwordHash, opts.name ?? "Tester", opts.role ?? "member", country,
      opts.verified === false ? null : new Date(), opts.scope ?? "domestic"],
  );
  const id = r.rows[0].id;
  await pool().query("INSERT INTO credit_accounts (user_id) VALUES ($1)", [id]);
  const addressId = await saveAddress(id, {
    label: "", recipientName: "Test Person", line1: "1 Test Street", line2: "", city: "Testville",
    region: country === "US" || country === "CA" ? "XX" : "", postalCode: "T1 1TT", country, phone: "", isDefault: true,
  });
  if (opts.credits) {
    const admin = await adminUser();
    await adminAdjust({ adminId: admin, userId: id, amount: opts.credits, reason: "Test starting balance", idempotencyKey: randomUUID() });
  }
  return { id, addressId };
}

export async function adminUser() {
  const existing = await pool().query<{ id: string }>("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existing.rows[0]) return existing.rows[0].id;
  passwordHash ??= await hashPassword("test-password-123");
  const r = await pool().query<{ id: string }>(
    `INSERT INTO users (email, password_hash, display_name, role, country_code, email_verified_at)
     VALUES ($1, $2, 'Admin', 'admin', 'GB', now()) RETURNING id`,
    [`admin-${randomUUID()}@test.yos`, passwordHash],
  );
  return r.rows[0].id;
}

export async function makeListing(ownerId: string, opts: { title?: string; scope?: "domestic" | "international"; shipCountries?: string[] } = {}) {
  const id = await createListing(
    ownerId,
    { input: { title: opts.title ?? `Book ${randomUUID().slice(0, 6)}`, authors: ["Test Author"] } },
    {
      format: "paperback", language: "en", condition: "good", conditionNotes: "Normal wear, no markings.", editionNotes: "",
      categoryId: null, weightGrams: 300, shipScope: opts.scope ?? "domestic", shipCountries: opts.shipCountries ?? [],
    },
  );
  await tx(async (c) => {
    const fileId = await saveBuffer(c, placeholderPng(8, 8, 120), "listing_photo", ownerId);
    await c.query("INSERT INTO listing_photos (listing_id, file_id) VALUES ($1, $2)", [id, fileId]);
  });
  await publishListing(ownerId, id, { confirmPossession: true, confirmAnotherCopy: true });
  return id;
}

export async function balance(userId: string) {
  const r = await pool().query<{ available: number; reserved: number }>("SELECT available, reserved FROM credit_accounts WHERE user_id = $1", [userId]);
  return r.rows[0];
}

export async function exchangeStatus(id: string) {
  return (await pool().query<{ status: string }>("SELECT status FROM exchanges WHERE id = $1", [id])).rows[0].status;
}

export async function listingStatus(id: string) {
  return (await pool().query<{ status: string }>("SELECT status FROM listings WHERE id = $1", [id])).rows[0].status;
}

export const key = () => randomUUID();

/** Runs every scheduled job once and summarizes the exchange transitions. */
export async function processDue() {
  const { runJobs } = await import("@/server/jobs/runner");
  const r = await runJobs();
  return {
    expired: r["exchanges.expire-requests"].processed,
    dispatchMissed: r["exchanges.cancel-missed-dispatch"].processed,
    autoDelivered: r["exchanges.auto-confirm-delivery"].processed,
    completed: r["exchanges.complete-after-window"].processed,
    all: r,
  };
}
