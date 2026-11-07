import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, pool, tx } from "@/server/db";
import { adminAdjust, postLedgerEvent, reconcile, reverseEntry, getWallet } from "@/server/domain/credits";
import { adminUser, balance, key, makeUser, resetData } from "./helpers";

beforeEach(resetData);
afterAll(closePool);

describe("credit ledger", () => {
  it("requires a reason for admin adjustments and writes an audit record", async () => {
    const admin = await adminUser();
    const m = await makeUser();
    await expect(
      adminAdjust({ adminId: admin, userId: m.id, amount: 1, reason: "", idempotencyKey: key() }),
    ).rejects.toThrow(/reason/);
    await adminAdjust({
      adminId: admin,
      userId: m.id,
      amount: 2,
      reason: "Goodwill after carrier loss",
      idempotencyKey: key(),
    });
    expect(await balance(m.id)).toEqual({ available: 2, reserved: 0 });
    const a = await pool().query(
      "SELECT reason, metadata FROM admin_audit_logs WHERE action = 'credit.adjust' AND target_id = $1",
      [m.id],
    );
    expect(a.rows[0].reason).toBe("Goodwill after carrier loss");
    expect(a.rows[0].metadata.amount).toBe(2);
  });

  it("never lets an adjustment push a balance below zero", async () => {
    const m = await makeUser({ credits: 1 });
    await expect(
      adminAdjust({
        adminId: await adminUser(),
        userId: m.id,
        amount: -2,
        reason: "Correction test",
        idempotencyKey: key(),
      }),
    ).rejects.toThrow(/enough available credits/);
    expect(await balance(m.id)).toEqual({ available: 1, reserved: 0 });
  });

  it("is idempotent per key", async () => {
    const m = await makeUser();
    const k = key();
    const admin = await adminUser();
    await adminAdjust({ adminId: admin, userId: m.id, amount: 1, reason: "Duplicate click", idempotencyKey: k });
    await adminAdjust({ adminId: admin, userId: m.id, amount: 1, reason: "Duplicate click", idempotencyKey: k });
    expect(await balance(m.id)).toEqual({ available: 1, reserved: 0 });
  });

  it("is append-only at the database level", async () => {
    const m = await makeUser({ credits: 1 });
    await expect(
      pool().query("UPDATE credit_ledger SET available_delta = 100 WHERE user_id = $1", [m.id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool().query("DELETE FROM credit_ledger WHERE user_id = $1", [m.id])).rejects.toThrow(/append-only/);
    await expect(pool().query("UPDATE credit_accounts SET available = -1 WHERE user_id = $1", [m.id])).rejects.toThrow(
      /check constraint/,
    );
  });

  it("can reverse an erroneous adjustment exactly once", async () => {
    const admin = await adminUser();
    const m = await makeUser();
    const e = await adminAdjust({
      adminId: admin,
      userId: m.id,
      amount: 3,
      reason: "Entered wrong amount",
      idempotencyKey: key(),
    });
    await reverseEntry({ adminId: admin, ledgerId: e.id, reason: "Reversing mistaken adjustment" });
    await reverseEntry({ adminId: admin, ledgerId: e.id, reason: "Reversing mistaken adjustment" });
    expect(await balance(m.id)).toEqual({ available: 0, reserved: 0 });
  });

  it("stays consistent with the summary table under concurrent writes", async () => {
    const m = await makeUser();
    const admin = await adminUser();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        tx((c) =>
          postLedgerEvent(c, {
            userId: m.id,
            type: "credit_admin_adjustment",
            availableDelta: 1,
            reservedDelta: 0,
            reason: `parallel ${i}`,
            actorType: "admin",
            actorId: admin,
            idempotencyKey: `p-${m.id}-${i}`,
          }),
        ),
      ),
    );
    expect(await balance(m.id)).toEqual({ available: 20, reserved: 0 });
    expect(await reconcile()).toEqual([]);
    const w = await getWallet(m.id);
    expect(w.available).toBe(20);
    expect(w.lifetimeEarned).toBe(0); // adjustments aren't "earned" credits
  });
});
