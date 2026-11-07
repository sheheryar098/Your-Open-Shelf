import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closePool, pool } from "@/server/db";
import { addDays, setNow } from "@/server/clock";
import { requestBook, acceptRequest } from "@/server/domain/exchanges";
import { reconcile } from "@/server/domain/credits";
import { queueEmail, EmailPriority } from "@/server/domain/notifications";
import { MAX_ITEM_ATTEMPTS, jobHealth, runJob, runJobs } from "@/server/jobs/runner";
import { EMAIL_MAX_ATTEMPTS, EmailSendError, consoleTransport, emailBackoffMs, setEmailTransport } from "@/server/jobs/email";
import { exchangeStatus, key, makeListing, makeUser, resetData } from "./helpers";

beforeEach(resetData);
afterEach(() => setEmailTransport(consoleTransport));
afterAll(closePool);

async function pendingRequest() {
  const sender = await makeUser();
  const req = await makeUser({ credits: 1 });
  const id = await requestBook({ requesterId: req.id, listingId: await makeListing(sender.id), addressId: req.addressId, requestKey: key() });
  return { id, req, sender };
}

describe("scheduled exchange jobs", () => {
  it("isolate a poison item: others still process, and it is parked after repeated failures", async () => {
    const good = await pendingRequest();
    const bad = await pendingRequest();
    // Corrupt the bad requester's summary so releasing their credit fails.
    await pool().query("UPDATE credit_accounts SET reserved = 0 WHERE user_id = $1", [bad.req.id]);
    setNow(addDays(new Date(), 4));

    const first = await runJob("exchanges.expire-requests");
    expect(first).toMatchObject({ status: "partial", processed: 1, failed: 1 });
    expect(await exchangeStatus(good.id)).toBe("expired");
    expect(await exchangeStatus(bad.id)).toBe("requested"); // rolled back, untouched

    for (let i = 1; i < MAX_ITEM_ATTEMPTS; i++) await runJob("exchanges.expire-requests");
    const parked = await runJob("exchanges.expire-requests");
    expect(parked).toMatchObject({ status: "ok", failed: 0, parked: 1 }); // skipped, not retried forever

    const health = await jobHealth();
    expect(health.ok).toBe(false);
    expect(health.parkedItems).toBe(1);
    const run = await pool().query("SELECT last_status FROM job_runs WHERE name = 'exchanges.expire-requests'");
    expect(run.rows[0].last_status).toBe("ok");
  });

  it("are safe to run concurrently: each job runs once and credits move once", async () => {
    const a = await pendingRequest();
    const b = await pendingRequest();
    await acceptRequest(b.sender.id, b.id);
    setNow(addDays(new Date(), 12));
    await Promise.all([runJobs(), runJobs(), runJobs()]);
    expect(await exchangeStatus(a.id)).toBe("expired");
    expect(await exchangeStatus(b.id)).toBe("cancelled");
    const releases = await pool().query("SELECT count(*)::int AS n FROM credit_ledger WHERE event_type = 'credit_released'");
    expect(releases.rows[0].n).toBe(2);
    expect(await reconcile()).toEqual([]);
  });

  it("send each deadline reminder once", async () => {
    const { sender } = await pendingRequest();
    setNow(addDays(new Date(), 2.5)); // within 24h of the 3-day response deadline
    await runJobs();
    await runJobs();
    const n = await pool().query("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'dispatch_reminder'", [sender.id]);
    expect(n.rows[0].n).toBe(1);
  });
});

describe("email outbox", () => {
  it("retries transient failures with backoff and dead-letters permanent ones", async () => {
    await queueEmail(pool(), "flaky@test.yos", "Flaky", "body");
    await queueEmail(pool(), "invalid@test.yos", "Invalid", "body");
    setEmailTransport({
      async send(m) {
        if (m.to.startsWith("flaky")) throw new Error("connection reset");
        throw new EmailSendError("mailbox does not exist", false);
      },
    });
    await runJob("email.deliver");
    const rows = (await pool().query("SELECT to_email, status, attempts, next_attempt_at > now() AS later FROM email_outbox ORDER BY to_email")).rows;
    expect(rows).toEqual([
      { to_email: "flaky@test.yos", status: "queued", attempts: 1, later: true },
      { to_email: "invalid@test.yos", status: "dead", attempts: 1, later: true },
    ]);
    // Not retried before its backoff elapses.
    await runJob("email.deliver");
    expect((await pool().query("SELECT attempts FROM email_outbox WHERE to_email = 'flaky@test.yos'")).rows[0].attempts).toBe(1);
    expect((await jobHealth()).deadEmails).toBe(1);
  });

  it("gives up after the attempt limit", async () => {
    await queueEmail(pool(), "down@test.yos", "Down", "body");
    setEmailTransport({ async send() { throw new Error("provider unavailable"); } });
    for (let i = 0; i < EMAIL_MAX_ATTEMPTS; i++) {
      await pool().query("UPDATE email_outbox SET next_attempt_at = now() - interval '1 second'");
      await runJob("email.deliver");
    }
    expect((await pool().query("SELECT status, attempts FROM email_outbox")).rows[0]).toEqual({ status: "dead", attempts: EMAIL_MAX_ATTEMPTS });
  });

  it("delivers security mail in its own lane", async () => {
    await queueEmail(pool(), "bulk@test.yos", "Wish-list match", "body", EmailPriority.optional);
    await queueEmail(pool(), "reset@test.yos", "Reset your password", "body", EmailPriority.security);
    const sent: string[] = [];
    setEmailTransport({ async send(m) { sent.push(m.to); return { messageId: m.idempotencyKey }; } });
    await runJob("email.deliver-priority");
    expect(sent).toEqual(["reset@test.yos"]);
  });

  it("uses jittered exponential backoff", () => {
    expect(emailBackoffMs(1, () => 0)).toBe(15_000);
    expect(emailBackoffMs(1, () => 1)).toBe(30_000);
    expect(emailBackoffMs(4, () => 1)).toBe(240_000);
    expect(emailBackoffMs(20, () => 1)).toBe(3_600_000);
  });
});
