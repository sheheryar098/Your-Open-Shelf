import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, pool } from "@/server/db";
import { addDays, now, setNow } from "@/server/clock";
import {
  acceptRequest, cancelRequest, confirmReceipt, declineRequest, getExchangeForViewer, markShipped,
  openDispute, requestBook, resolveDispute, senderCancel, leaveReview, withdrawDispute,
} from "@/server/domain/exchanges";
import { reconcile, getWallet } from "@/server/domain/credits";
import { balance, exchangeStatus, key, listingStatus, makeListing, makeUser, resetData, adminUser, processDue } from "./helpers";

const today = () => now().toISOString().slice(0, 10);
const ship = (senderId: string, id: string, tracking = `TRK${Math.random().toString(36).slice(2, 12).toUpperCase()}`) =>
  markShipped(senderId, id, { carrier: "Royal Mail", trackingNumber: tracking, dispatchDate: today() });

beforeEach(resetData);
afterAll(async () => {
  expect(await reconcile()).toEqual([]);
  await closePool();
});

describe("requesting a book", () => {
  it("reserves exactly one credit and the listing copy", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 2 });
    const listing = await makeListing(sender.id);
    const ex = await requestBook({ requesterId: req.id, listingId: listing, addressId: req.addressId, requestKey: key() });
    expect(await exchangeStatus(ex)).toBe("requested");
    expect(await balance(req.id)).toEqual({ available: 1, reserved: 1 });
    expect(await listingStatus(listing)).toBe("reserved");
  });

  it("is rejected without sufficient available credits", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 0 });
    const listing = await makeListing(sender.id);
    await expect(requestBook({ requesterId: req.id, listingId: listing, addressId: req.addressId, requestKey: key() }))
      .rejects.toThrow(/enough available credits/);
    expect(await listingStatus(listing)).toBe("active");
    const n = await pool().query("SELECT count(*)::int AS n FROM exchanges");
    expect(n.rows[0].n).toBe(0);
  });

  it("cannot spend the same credit twice in concurrent requests", async () => {
    const s1 = await makeUser();
    const s2 = await makeUser();
    const req = await makeUser({ credits: 1 });
    const [l1, l2] = [await makeListing(s1.id), await makeListing(s2.id)];
    const results = await Promise.allSettled([
      requestBook({ requesterId: req.id, listingId: l1, addressId: req.addressId, requestKey: key() }),
      requestBook({ requesterId: req.id, listingId: l2, addressId: req.addressId, requestKey: key() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await balance(req.id)).toEqual({ available: 0, reserved: 1 });
  });

  it("cannot reserve one copy for two members simultaneously", async () => {
    const sender = await makeUser();
    const a = await makeUser({ credits: 1 });
    const b = await makeUser({ credits: 1 });
    const listing = await makeListing(sender.id);
    const results = await Promise.allSettled([
      requestBook({ requesterId: a.id, listingId: listing, addressId: a.addressId, requestKey: key() }),
      requestBook({ requesterId: b.id, listingId: listing, addressId: b.addressId, requestKey: key() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const reserved = (await balance(a.id)).reserved + (await balance(b.id)).reserved;
    expect(reserved).toBe(1);
  });

  it("is idempotent for a repeated submit with the same request key", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 3 });
    const listing = await makeListing(sender.id);
    const k = key();
    const a = await requestBook({ requesterId: req.id, listingId: listing, addressId: req.addressId, requestKey: k });
    const b = await requestBook({ requesterId: req.id, listingId: listing, addressId: req.addressId, requestKey: k });
    expect(a).toBe(b);
    expect(await balance(req.id)).toEqual({ available: 2, reserved: 1 });
  });

  it("blocks unsupported routes and domestic-only senders", async () => {
    // GB → US exists in the matrix but is disabled at launch.
    const gb = await makeUser({ country: "GB", scope: "international" });
    const us = await makeUser({ country: "US", credits: 1 });
    const intl = await makeListing(gb.id, { scope: "international" });
    await expect(requestBook({ requesterId: us.id, listingId: intl, addressId: us.addressId, requestKey: key() }))
      .rejects.toThrow(/isn't supported yet/);

    // GB → IE is enabled, but this sender only ships domestically.
    const ie = await makeUser({ country: "IE", credits: 1 });
    const domestic = await makeListing(gb.id, { scope: "domestic" });
    await expect(requestBook({ requesterId: ie.id, listingId: domestic, addressId: ie.addressId, requestKey: key() }))
      .rejects.toThrow(/only ships within/);

    // Waitlisted countries can't transact at all.
    const fr = await makeUser({ country: "FR", credits: 1 });
    await expect(requestBook({ requesterId: fr.id, listingId: intl, addressId: fr.addressId, requestKey: key() }))
      .rejects.toThrow(/doesn't support deliveries/);
    expect(await balance(us.id)).toEqual({ available: 1, reserved: 0 });
  });

  it("requires a verified email", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 1, verified: false });
    const listing = await makeListing(sender.id);
    await expect(requestBook({ requesterId: req.id, listingId: listing, addressId: req.addressId, requestKey: key() }))
      .rejects.toThrow(/Verify your email/);
  });

  it("hides the delivery address from the sender until they accept", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 1 });
    const ex = await requestBook({ requesterId: req.id, listingId: await makeListing(sender.id), addressId: req.addressId, requestKey: key() });
    const before = await getExchangeForViewer(ex, { id: sender.id, role: "member" });
    expect(before?.address).toBeNull();
    expect(before?.addressSummary?.city).toBe("Testville");
    await acceptRequest(sender.id, ex);
    const after = await getExchangeForViewer(ex, { id: sender.id, role: "member" });
    expect(after?.address?.line1).toBe("1 Test Street");
    const stranger = await makeUser();
    expect(await getExchangeForViewer(ex, { id: stranger.id, role: "member" })).toBeNull();
  });
});

describe("ending a request before shipment releases the credit", () => {
  it("on decline", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 1 });
    const listing = await makeListing(sender.id);
    const ex = await requestBook({ requesterId: req.id, listingId: listing, addressId: req.addressId, requestKey: key() });
    await declineRequest(sender.id, ex, "Sorry, just gave it to a friend", false);
    expect(await balance(req.id)).toEqual({ available: 1, reserved: 0 });
    expect(await listingStatus(listing)).toBe("active");
  });

  it("on requester cancellation, but not after acceptance", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 2 });
    const ex = await requestBook({ requesterId: req.id, listingId: await makeListing(sender.id), addressId: req.addressId, requestKey: key() });
    await cancelRequest(req.id, ex);
    expect(await balance(req.id)).toEqual({ available: 2, reserved: 0 });

    const ex2 = await requestBook({ requesterId: req.id, listingId: await makeListing(sender.id), addressId: req.addressId, requestKey: key() });
    await acceptRequest(sender.id, ex2);
    await expect(cancelRequest(req.id, ex2)).rejects.toThrow(/before the sender accepts/);
  });

  it("when the sender doesn't respond in time", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 1 });
    const listing = await makeListing(sender.id);
    const ex = await requestBook({ requesterId: req.id, listingId: listing, addressId: req.addressId, requestKey: key() });
    setNow(addDays(new Date(), 4));
    const r = await processDue();
    expect(r.expired).toBe(1);
    expect(await exchangeStatus(ex)).toBe("expired");
    expect(await balance(req.id)).toEqual({ available: 1, reserved: 0 });
    expect(await listingStatus(listing)).toBe("active");
    await expect(acceptRequest(sender.id, ex)).rejects.toThrow();
  });

  it("when the sender misses the dispatch deadline, or cancels", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 2 });
    const l1 = await makeListing(sender.id);
    const ex = await requestBook({ requesterId: req.id, listingId: l1, addressId: req.addressId, requestKey: key() });
    await acceptRequest(sender.id, ex);
    setNow(addDays(new Date(), 10));
    expect((await processDue()).dispatchMissed).toBe(1);
    expect(await exchangeStatus(ex)).toBe("cancelled");
    expect(await listingStatus(l1)).toBe("paused");
    setNow(null);

    const ex2 = await requestBook({ requesterId: req.id, listingId: await makeListing(sender.id), addressId: req.addressId, requestKey: key() });
    await acceptRequest(sender.id, ex2);
    await senderCancel(sender.id, ex2, "The book got damaged in a leak");
    expect(await balance(req.id)).toEqual({ available: 2, reserved: 0 });
  });
});

describe("dispatch, delivery and completion", () => {
  it("awards the sender's credit only once, after qualifying completion", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 1 });
    const listing = await makeListing(sender.id);
    expect(await balance(sender.id)).toEqual({ available: 0, reserved: 0 }); // listing alone earns nothing

    const ex = await requestBook({ requesterId: req.id, listingId: listing, addressId: req.addressId, requestKey: key() });
    await acceptRequest(sender.id, ex);
    expect(await balance(sender.id)).toEqual({ available: 0, reserved: 0 });
    await ship(sender.id, ex);
    expect(await balance(sender.id)).toEqual({ available: 0, reserved: 0 });
    expect((await getWallet(sender.id)).pending).toBe(1);

    await confirmReceipt(req.id, ex);
    await expect(confirmReceipt(req.id, ex)).rejects.toThrow();
    expect(await balance(sender.id)).toEqual({ available: 1, reserved: 0 });
    expect(await balance(req.id)).toEqual({ available: 0, reserved: 0 });
    expect(await listingStatus(listing)).toBe("exchanged");
    const earned = await pool().query("SELECT count(*)::int AS n FROM credit_ledger WHERE event_type = 'credit_earned' AND exchange_id = $1", [ex]);
    expect(earned.rows[0].n).toBe(1);

    // The sender's earned credit can be used to request a different member's book (§3.2).
    const third = await makeUser();
    const next = await requestBook({ requesterId: sender.id, listingId: await makeListing(third.id), addressId: sender.addressId, requestKey: key() });
    expect(await exchangeStatus(next)).toBe("requested");
  });

  it("auto-confirms tracked parcels, then completes after the dispute window", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 1 });
    const ex = await requestBook({ requesterId: req.id, listingId: await makeListing(sender.id), addressId: req.addressId, requestKey: key() });
    await acceptRequest(sender.id, ex);
    await ship(sender.id, ex);
    setNow(addDays(new Date(), 13)); // GB domestic max 5 days + 7 grace
    expect((await processDue()).autoDelivered).toBe(1);
    expect(await exchangeStatus(ex)).toBe("delivered");
    expect(await balance(sender.id)).toEqual({ available: 0, reserved: 0 });
    setNow(addDays(new Date(), 17));
    expect((await processDue()).completed).toBe(1);
    expect(await exchangeStatus(ex)).toBe("completed");
    expect(await balance(sender.id)).toEqual({ available: 1, reserved: 0 });
  });

  it("requires tracking on routes that need it and rejects reused tracking numbers", async () => {
    const gb = await makeUser({ country: "GB", scope: "international" });
    const ie = await makeUser({ country: "IE", credits: 2 });
    const ex = await requestBook({ requesterId: ie.id, listingId: await makeListing(gb.id, { scope: "international" }), addressId: ie.addressId, requestKey: key() });
    await acceptRequest(gb.id, ex);
    await expect(markShipped(gb.id, ex, { carrier: "An Post", dispatchDate: today() })).rejects.toThrow(/requires a tracked service/);
    await expect(markShipped(gb.id, ex, { carrier: "An Post", trackingNumber: "AAAAAAAAAA", dispatchDate: today() })).rejects.toThrow(/real tracking number/);
    await ship(gb.id, ex, "RR123456785GB");

    const ex2 = await requestBook({ requesterId: ie.id, listingId: await makeListing(gb.id, { scope: "international" }), addressId: ie.addressId, requestKey: key() });
    await acceptRequest(gb.id, ex2);
    await expect(ship(gb.id, ex2, "RR123456785GB")).rejects.toThrow(/already been used/);
  });

  it("does not let members mark carrier delivery or act on others' exchanges", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 1 });
    const other = await makeUser();
    const ex = await requestBook({ requesterId: req.id, listingId: await makeListing(sender.id), addressId: req.addressId, requestKey: key() });
    await expect(acceptRequest(other.id, ex)).rejects.toThrow(/permission/);
    await expect(acceptRequest(req.id, ex)).rejects.toThrow(/permission/);
    await acceptRequest(sender.id, ex);
    await ship(sender.id, ex);
    await expect(confirmReceipt(sender.id, ex)).rejects.toThrow(/permission/);
  });

  it("allows reviews only after completion, once per member", async () => {
    const sender = await makeUser();
    const req = await makeUser({ credits: 1 });
    const ex = await requestBook({ requesterId: req.id, listingId: await makeListing(sender.id), addressId: req.addressId, requestKey: key() });
    await expect(leaveReview(req.id, ex, { rating: 5, tags: [] })).rejects.toThrow(/once the exchange is completed/);
    await acceptRequest(sender.id, ex);
    await ship(sender.id, ex);
    await confirmReceipt(req.id, ex);
    await leaveReview(req.id, ex, { rating: 4, tags: ["well_packed"] });
    await expect(leaveReview(req.id, ex, { rating: 5, tags: [] })).rejects.toThrow(/already left feedback/);
  });
});

describe("disputes", () => {
  async function shippedExchange() {
    const sender = await makeUser();
    const req = await makeUser({ credits: 1 });
    const listing = await makeListing(sender.id);
    const ex = await requestBook({ requesterId: req.id, listingId: listing, addressId: req.addressId, requestKey: key() });
    await acceptRequest(sender.id, ex);
    await ship(sender.id, ex);
    return { sender, req, ex, listing };
  }

  it("pauses the normal completion path", async () => {
    const { sender, req, ex } = await shippedExchange();
    const disputeId = await openDispute(req.id, ex, { issueType: "condition_mismatch", description: "Several pages are missing from the middle of the book." });
    expect(await exchangeStatus(ex)).toBe("disputed");
    setNow(addDays(new Date(), 60));
    const r = await processDue();
    expect(r.autoDelivered + r.completed).toBe(0);
    expect(await exchangeStatus(ex)).toBe("disputed");
    expect(await balance(sender.id)).toEqual({ available: 0, reserved: 0 });
    expect(disputeId).toBeTruthy();
  });

  it("restores the requester's credit when resolved in their favour", async () => {
    const { sender, req, ex, listing } = await shippedExchange();
    const d = await openDispute(req.id, ex, { issueType: "delivered_not_received", description: "Tracking stopped updating two weeks ago." });
    const admin = await adminUser();
    await expect(resolveDispute(sender.id, "member", d, "release_to_sender", "I want my credit please")).rejects.toThrow(/permission/);
    await resolveDispute(admin, "admin", d, "refund_requester", "Carrier confirmed the parcel was lost in transit.");
    expect(await exchangeStatus(ex)).toBe("refunded");
    expect(await balance(req.id)).toEqual({ available: 1, reserved: 0 });
    expect(await balance(sender.id)).toEqual({ available: 0, reserved: 0 });
    expect(await listingStatus(listing)).toBe("unavailable");
    const audits = await pool().query("SELECT count(*)::int AS n FROM admin_audit_logs WHERE action = 'dispute.resolve'");
    expect(audits.rows[0].n).toBe(1);
  });

  it("releases the credit to the sender when resolved in their favour", async () => {
    const { sender, req, ex } = await shippedExchange();
    const d = await openDispute(req.id, ex, { issueType: "other", description: "I opened this by mistake, sorry about that." });
    await resolveDispute(await adminUser(), "admin", d, "release_to_sender", "Recipient confirmed the book arrived fine.");
    expect(await exchangeStatus(ex)).toBe("completed");
    expect(await balance(sender.id)).toEqual({ available: 1, reserved: 0 });
  });

  it("can be withdrawn by the member who opened it", async () => {
    const { req, ex } = await shippedExchange();
    const d = await openDispute(req.id, ex, { issueType: "tracking_not_updating", description: "Tracking hasn't changed for a week now." });
    await withdrawDispute(req.id, d);
    expect(await exchangeStatus(ex)).toBe("shipped");
  });
});
