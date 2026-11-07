import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, pool, tx } from "@/server/db";
import { createListing, publishListing, searchListings, setOwnListingStatus, moderateListing, addToWishlist } from "@/server/domain/listings";
import { authenticate, registerUser, verifyEmail, setAccountStatus } from "@/server/domain/users";
import { updateCountry, upsertRoute, getRoute } from "@/server/domain/routes";
import { toIsbn13 } from "@/shared/lib/isbn";
import { addBusinessDays } from "@/server/clock";
import { saveBuffer } from "@/server/domain/files";
import { placeholderPng } from "../scripts/png";
import { adminUser, makeListing, makeUser, resetData, listingStatus } from "./helpers";

beforeEach(resetData);
afterAll(closePool);

const copy = {
  format: "paperback", language: "en", condition: "good", conditionNotes: "Light wear on the corners.", editionNotes: "",
  categoryId: null, weightGrams: null, shipScope: "domestic" as const, shipCountries: [],
};

describe("listings", () => {
  it("requires an actual-copy photo and a condition disclosure to publish", async () => {
    const m = await makeUser();
    const id = await createListing(m.id, { input: { title: "Emma", authors: ["Jane Austen"] } }, copy);
    await expect(publishListing(m.id, id, { confirmPossession: true })).rejects.toThrow(/photo/);
    await tx(async (c) => {
      const f = await saveBuffer(c, placeholderPng(4, 4, 10), "listing_photo", m.id);
      await c.query("INSERT INTO listing_photos (listing_id, file_id) VALUES ($1, $2)", [id, f]);
    });
    await expect(publishListing(m.id, id, { confirmPossession: false })).rejects.toThrow(/possession/);
    await publishListing(m.id, id, { confirmPossession: true });
    expect(await listingStatus(id)).toBe("active");
  });

  it("rejects non-image uploads by content, not by name", async () => {
    const m = await makeUser();
    await expect(tx((c) => saveBuffer(c, Buffer.from("<script>alert(1)</script>"), "listing_photo", m.id))).rejects.toThrow(/JPEG, PNG or WebP/);
  });

  it("supports pause and remove, and flags duplicate copies", async () => {
    const m = await makeUser();
    const id = await makeListing(m.id, { title: "Emma" });
    await setOwnListingStatus(m.id, id, "pause");
    expect(await listingStatus(id)).toBe("paused");
    await setOwnListingStatus(m.id, id, "resume");
    expect(await listingStatus(id)).toBe("active");
    const dup = await createListing(m.id, { input: { title: "Emma", authors: ["Test Author"] } }, copy);
    await tx(async (c) => {
      const f = await saveBuffer(c, placeholderPng(4, 4, 10), "listing_photo", m.id);
      await c.query("INSERT INTO listing_photos (listing_id, file_id) VALUES ($1, $2)", [dup, f]);
    });
    await expect(publishListing(m.id, dup, { confirmPossession: true })).rejects.toThrow(/another copy/);
    await setOwnListingStatus(m.id, id, "remove");
    expect(await listingStatus(id)).toBe("removed");
  });

  it("shares one catalog record per ISBN across members' copies", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const isbn = "0-306-40615-2";
    await createListing(a.id, { input: { isbn, title: "Some Book", authors: ["X"] } }, copy);
    await createListing(b.id, { input: { isbn: toIsbn13(isbn)!, title: "Some Book (typo)", authors: ["X"] } }, copy);
    const n = await pool().query("SELECT count(*)::int AS n FROM books");
    expect(n.rows[0].n).toBe(1);
    await expect(createListing(a.id, { input: { isbn: "1234567890", title: "Bad", authors: ["X"] } }, copy)).rejects.toThrow(/ISBN/);
  });

  it("searches by title/author and filters to books that can ship to the viewer", async () => {
    const gb = await makeUser({ country: "GB", scope: "domestic" });
    const ie = await makeUser({ country: "IE", scope: "international" });
    await makeListing(gb.id, { title: "The Lighthouse Keeper" });
    await makeListing(ie.id, { title: "Lighthouse Stories", scope: "international" });
    const all = await searchListings({ q: "lighthouse" });
    expect(all.total).toBe(2);
    const toIreland = await searchListings({ q: "lighthouse", shipsTo: "IE" });
    expect(toIreland.rows.map((r) => r.title)).toEqual(["Lighthouse Stories"]);
    const toUs = await searchListings({ shipsTo: "US" });
    expect(toUs.total).toBe(0);
  });

  it("keeps moderation actions in the audit log and notifies wish-listers", async () => {
    const admin = await adminUser();
    const owner = await makeUser();
    const id = await makeListing(owner.id);
    await moderateListing(admin, id, "removed", "Counterfeit edition reported and confirmed");
    expect(await listingStatus(id)).toBe("removed");
    const a = await pool().query("SELECT count(*)::int AS n FROM admin_audit_logs WHERE target_id = $1", [id]);
    expect(a.rows[0].n).toBe(1);

    const wisher = await makeUser();
    const l2 = await createListing(owner.id, { input: { title: "Wanted Book", authors: ["A"] } }, copy);
    const bookId = (await pool().query("SELECT book_id FROM listings WHERE id = $1", [l2])).rows[0].book_id;
    await addToWishlist(wisher.id, bookId);
    await tx(async (c) => {
      const f = await saveBuffer(c, placeholderPng(4, 4, 10), "listing_photo", owner.id);
      await c.query("INSERT INTO listing_photos (listing_id, file_id) VALUES ($1, $2)", [l2, f]);
    });
    await publishListing(owner.id, l2, { confirmPossession: true });
    const notes = await pool().query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'wishlist_match'", [wisher.id]);
    expect(notes.rows[0].n).toBe(1);
  });
});

describe("accounts", () => {
  it("registers, verifies email and signs in; suspended members can't sign in", async () => {
    const email = `new-${Date.now()}@test.yos`;
    const id = await registerUser({ displayName: "Newbie", email, password: "correct-horse-battery", country: "GB", acceptTerms: "on", confirmAge: "on" });
    await expect(registerUser({ displayName: "Dup", email: email.toUpperCase(), password: "correct-horse-battery", country: "GB", acceptTerms: "on", confirmAge: "on" }))
      .rejects.toThrow(/already exists/);
    const mail = await pool().query<{ body_text: string }>("SELECT body_text FROM email_outbox WHERE to_email = $1", [email]);
    const token = mail.rows[0].body_text.match(/token=([\w-]+)/)![1];
    expect(await verifyEmail(token)).toBe(id);
    expect(await verifyEmail(token)).toBeNull(); // single use
    await expect(authenticate(email, "wrong-password")).rejects.toThrow(/incorrect/);
    expect((await authenticate(email, "correct-horse-battery")).email_verified_at).toBeTruthy();
    await setAccountStatus(await adminUser(), id, "suspended", "Repeated failure to ship");
    await expect(authenticate(email, "correct-horse-battery")).rejects.toThrow(/suspended/);
  });
});

describe("countries and routes", () => {
  it("lets admins disable a route and audits the change", async () => {
    const admin = await adminUser();
    const r = (await getRoute("GB", "IE"))!;
    await upsertRoute(admin, { ...r, enabled: false }, "Carrier strike — pausing route");
    expect((await getRoute("GB", "IE"))!.enabled).toBe(false);
    await expect(upsertRoute(admin, { ...r, enabled: true, customs_notice: null, customs_required: false }, "Re-enable without customs"))
      .rejects.toThrow(/customs/);
    await updateCountry(admin, "FR", { status: "limited" }, "Pilot for Paris book clubs");
    const logs = await pool().query("SELECT action FROM admin_audit_logs ORDER BY id");
    expect(logs.rows.map((l) => l.action)).toEqual(["route.upsert", "country.update"]);
  });

  it("computes business-day dispatch deadlines", () => {
    const fri = new Date("2026-11-06T10:00:00Z");
    expect(addBusinessDays(fri, 5).toISOString()).toBe("2026-11-13T10:00:00.000Z");
  });
});
