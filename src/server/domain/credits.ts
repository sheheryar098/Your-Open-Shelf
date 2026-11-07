import type { PoolClient } from "pg";
import { query, queryOne, tx, type Db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { audit, requireReason } from "./audit";
import { notify } from "./notifications";

/**
 * Credit ledger.
 *
 * Every movement is an append-only ledger row. `credit_accounts` is a summary kept in the
 * same transaction under a row lock, with CHECK constraints that make a negative balance
 * (i.e. a double spend) impossible. The ledger remains the source of truth and can be
 * reconciled against the summary at any time.
 *
 *   event                     available  reserved   when
 *   credit_reserved              -n         +n       requester submits a request
 *   credit_released              +n         -n       declined / expired / cancelled before shipment
 *   credit_spent                  0         -n       exchange completes (requester side)
 *   credit_earned                +n          0       exchange completes (sender side)
 *   credit_refunded              +n         -n       dispute resolved in the requester's favour
 *   credit_admin_adjustment      ±n          0       authorized staff correction (reason + audit)
 *   credit_reversed              -delta of the reversed event
 */
export type LedgerEventType =
  | "credit_earned"
  | "credit_reserved"
  | "credit_spent"
  | "credit_released"
  | "credit_refunded"
  | "credit_admin_adjustment"
  | "credit_reversed";

export interface LedgerEntry {
  id: string;
  user_id: string;
  event_type: LedgerEventType;
  available_delta: number;
  reserved_delta: number;
  exchange_id: string | null;
  reason: string;
  actor_type: "system" | "member" | "admin";
  actor_id: string | null;
  idempotency_key: string;
  reverses_id: string | null;
  created_at: Date;
}

export interface PostInput {
  userId: string;
  type: LedgerEventType;
  availableDelta: number;
  reservedDelta: number;
  exchangeId?: string | null;
  reason: string;
  actorType: "system" | "member" | "admin";
  actorId?: string | null;
  idempotencyKey: string;
  reversesId?: string | null;
}

export class InsufficientCreditsError extends DomainError {
  constructor() {
    super("You don't have enough available credits for this request.", "insufficient_credits");
  }
}

async function lockAccount(c: PoolClient, userId: string) {
  await c.query("INSERT INTO credit_accounts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [userId]);
  const r = await c.query<{ available: number; reserved: number }>(
    "SELECT available, reserved FROM credit_accounts WHERE user_id = $1 FOR UPDATE",
    [userId],
  );
  return r.rows[0];
}

/**
 * Posts one ledger event atomically with the balance update. Must run inside a transaction.
 * Idempotent: re-posting an existing key returns the original entry without side effects.
 */
export async function postLedgerEvent(c: PoolClient, e: PostInput): Promise<{ entry: LedgerEntry; created: boolean }> {
  if (!Number.isInteger(e.availableDelta) || !Number.isInteger(e.reservedDelta)) {
    throw new DomainError("Credit amounts must be whole numbers.");
  }
  const account = await lockAccount(c, e.userId);

  const existing = await c.query<LedgerEntry>("SELECT * FROM credit_ledger WHERE idempotency_key = $1", [
    e.idempotencyKey,
  ]);
  if (existing.rows[0]) {
    const prev = existing.rows[0];
    // api-design: a replayed key must describe the same operation, otherwise refuse it.
    const same =
      prev.user_id === e.userId &&
      prev.event_type === e.type &&
      prev.available_delta === e.availableDelta &&
      prev.reserved_delta === e.reservedDelta &&
      (prev.exchange_id ?? null) === (e.exchangeId ?? null);
    if (!same) {
      throw new DomainError(
        "This operation key was already used for a different credit change. Reload the page and try again.",
        "idempotency_mismatch",
      );
    }
    return { entry: prev, created: false };
  }

  const available = account.available + e.availableDelta;
  const reserved = account.reserved + e.reservedDelta;
  if (available < 0) throw new InsufficientCreditsError();
  if (reserved < 0) throw new Error(`Reserved credits for ${e.userId} would become negative`);

  const ins = await c.query<LedgerEntry>(
    `INSERT INTO credit_ledger
       (user_id, event_type, available_delta, reserved_delta, exchange_id, reason, actor_type, actor_id, idempotency_key, reverses_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      e.userId,
      e.type,
      e.availableDelta,
      e.reservedDelta,
      e.exchangeId ?? null,
      e.reason,
      e.actorType,
      e.actorId ?? null,
      e.idempotencyKey,
      e.reversesId ?? null,
    ],
  );
  await c.query("UPDATE credit_accounts SET available = $2, reserved = $3, updated_at = now() WHERE user_id = $1", [
    e.userId,
    available,
    reserved,
  ]);
  return { entry: ins.rows[0], created: true };
}

// ---------------------------------------------------------------------------
// Exchange-driven helpers (called by the exchange state machine inside its transaction)
// ---------------------------------------------------------------------------

export function reserveForExchange(c: PoolClient, userId: string, exchangeId: string, amount: number) {
  return postLedgerEvent(c, {
    userId,
    type: "credit_reserved",
    availableDelta: -amount,
    reservedDelta: amount,
    exchangeId,
    reason: "Reserved for book request",
    actorType: "member",
    actorId: userId,
    idempotencyKey: `reserve:${exchangeId}`,
  });
}

export function releaseForExchange(c: PoolClient, userId: string, exchangeId: string, amount: number, reason: string) {
  return postLedgerEvent(c, {
    userId,
    type: "credit_released",
    availableDelta: amount,
    reservedDelta: -amount,
    exchangeId,
    reason,
    actorType: "system",
    idempotencyKey: `release:${exchangeId}`,
  });
}

export function refundForExchange(
  c: PoolClient,
  userId: string,
  exchangeId: string,
  amount: number,
  reason: string,
  actorId: string,
) {
  return postLedgerEvent(c, {
    userId,
    type: "credit_refunded",
    availableDelta: amount,
    reservedDelta: -amount,
    exchangeId,
    reason,
    actorType: "admin",
    actorId,
    idempotencyKey: `refund:${exchangeId}`,
  });
}

export async function settleExchange(
  c: PoolClient,
  ex: { id: string; requester_id: string; sender_id: string; credit_cost: number },
  actor: { type: "system" | "admin"; id?: string | null },
) {
  // Lock both accounts in a stable order so concurrent settlements can't deadlock.
  for (const id of [ex.requester_id, ex.sender_id].sort()) await lockAccount(c, id);
  await postLedgerEvent(c, {
    userId: ex.requester_id,
    type: "credit_spent",
    availableDelta: 0,
    reservedDelta: -ex.credit_cost,
    exchangeId: ex.id,
    reason: "Exchange completed, credit spent",
    actorType: actor.type,
    actorId: actor.id,
    idempotencyKey: `spend:${ex.id}`,
  });
  // Awarded exactly once per exchange: the idempotency key is unique in the ledger.
  return postLedgerEvent(c, {
    userId: ex.sender_id,
    type: "credit_earned",
    availableDelta: ex.credit_cost,
    reservedDelta: 0,
    exchangeId: ex.id,
    reason: "Exchange completed, credit earned for sending a book",
    actorType: actor.type,
    actorId: actor.id,
    idempotencyKey: `earn:${ex.id}`,
  });
}

// ---------------------------------------------------------------------------
// Staff operations. Each one needs a reason and writes an audit record.
// ---------------------------------------------------------------------------

export async function adminAdjust(input: {
  adminId: string;
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  exchangeId?: string | null;
}) {
  const reason = requireReason(input.reason);
  if (!Number.isInteger(input.amount) || input.amount === 0 || Math.abs(input.amount) > 100) {
    throw new DomainError("Adjustment must be a non-zero whole number between -100 and 100.");
  }
  return tx(async (c) => {
    const { entry, created } = await postLedgerEvent(c, {
      userId: input.userId,
      type: "credit_admin_adjustment",
      availableDelta: input.amount,
      reservedDelta: 0,
      exchangeId: input.exchangeId ?? null,
      reason,
      actorType: "admin",
      actorId: input.adminId,
      idempotencyKey: `adjust:${input.idempotencyKey}`,
    });
    if (created) {
      await audit(c, {
        actorId: input.adminId,
        action: "credit.adjust",
        targetType: "user",
        targetId: input.userId,
        reason,
        metadata: { amount: input.amount, ledgerId: entry.id, exchangeId: input.exchangeId ?? null },
      });
      await notify(c, input.userId, {
        type: "credit",
        title:
          input.amount > 0
            ? `YOS added ${input.amount} credit${input.amount === 1 ? "" : "s"} to your wallet`
            : `YOS removed ${-input.amount} credit${input.amount === -1 ? "" : "s"} from your wallet`,
        body: `Reason: ${reason}`,
        link: "/wallet",
      });
    }
    return entry;
  });
}

/** Reverses an erroneous earned or adjustment event. Reserve/release flows are reversed through exchange state instead. */
export async function reverseEntry(input: { adminId: string; ledgerId: string; reason: string }) {
  const reason = requireReason(input.reason);
  return tx(async (c) => {
    const orig = (await c.query<LedgerEntry>("SELECT * FROM credit_ledger WHERE id = $1", [input.ledgerId])).rows[0];
    if (!orig) throw new DomainError("Ledger entry not found.");
    if (!["credit_earned", "credit_admin_adjustment"].includes(orig.event_type)) {
      throw new DomainError("Only earned credits and staff adjustments can be reversed directly.");
    }
    const { entry, created } = await postLedgerEvent(c, {
      userId: orig.user_id,
      type: "credit_reversed",
      availableDelta: -orig.available_delta,
      reservedDelta: -orig.reserved_delta,
      exchangeId: orig.exchange_id,
      reason,
      actorType: "admin",
      actorId: input.adminId,
      idempotencyKey: `reverse:${orig.id}`,
      reversesId: orig.id,
    });
    if (created) {
      await audit(c, {
        actorId: input.adminId,
        action: "credit.reverse",
        targetType: "ledger",
        targetId: String(orig.id),
        reason,
        metadata: { userId: orig.user_id, reversedEvent: orig.event_type, delta: -orig.available_delta },
      });
      await notify(c, orig.user_id, {
        type: "credit",
        title: "A credit entry on your account was reversed",
        body: `Reason: ${reason}`,
        link: "/wallet",
      });
    }
    return entry;
  });
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------

export interface Wallet {
  available: number;
  reserved: number;
  pending: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
}

export async function getWallet(userId: string, db: Db | undefined = undefined): Promise<Wallet> {
  const acct = await queryOne<{ available: number; reserved: number }>(
    "SELECT available, reserved FROM credit_accounts WHERE user_id = $1",
    [userId],
    db,
  );
  const totals = await queryOne<{ earned: string; spent: string }>(
    `SELECT
       coalesce(sum(available_delta) FILTER (WHERE event_type = 'credit_earned'
         OR (event_type = 'credit_reversed' AND reverses_id IN (SELECT id FROM credit_ledger
           WHERE event_type = 'credit_earned'))), 0) AS earned,
       coalesce(-sum(reserved_delta) FILTER (WHERE event_type = 'credit_spent'), 0) AS spent
       FROM credit_ledger WHERE user_id = $1`,
    [userId],
    db,
  );
  // Pending = credits the member will earn once in-flight outgoing exchanges complete.
  const pending = await queryOne<{ n: string }>(
    `SELECT coalesce(sum(credit_cost), 0) AS n FROM exchanges
      WHERE sender_id = $1 AND status IN ('shipped', 'delivered', 'disputed')`,
    [userId],
    db,
  );
  return {
    available: acct?.available ?? 0,
    reserved: acct?.reserved ?? 0,
    pending: Number(pending?.n ?? 0),
    lifetimeEarned: Number(totals?.earned ?? 0),
    lifetimeSpent: Number(totals?.spent ?? 0),
  };
}

/** Cursor-paginated history, newest first. `before` is the id of the last entry already shown. */
export async function ledgerFor(userId: string, opts: { limit?: number; before?: string | null } = {}, db?: Db) {
  const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
  const before = opts.before && /^\d+$/.test(opts.before) ? opts.before : null;
  const rows = await query<LedgerEntry & { book_title: string | null }>(
    `SELECT l.*, b.title AS book_title
       FROM credit_ledger l
       LEFT JOIN exchanges e ON e.id = l.exchange_id
       LEFT JOIN listings li ON li.id = e.listing_id
       LEFT JOIN books b ON b.id = li.book_id
      WHERE l.user_id = $1 AND ($2::bigint IS NULL OR l.id < $2::bigint) ORDER BY l.id DESC LIMIT $3`,
    [userId, before, limit + 1],
    db,
  );
  const page = rows.slice(0, limit);
  return { rows: page, nextCursor: rows.length > limit ? String(page[page.length - 1].id) : null };
}

/** Lists accounts whose summary disagrees with the ledger. Should always be empty. */
export async function reconcile(db?: Db) {
  return query<{
    user_id: string;
    available: number;
    reserved: number;
    ledger_available: number;
    ledger_reserved: number;
  }>(
    `SELECT u.id AS user_id,
            coalesce(a.available, 0) AS available, coalesce(a.reserved, 0) AS reserved,
            coalesce(l.av, 0)::int AS ledger_available, coalesce(l.rs, 0)::int AS ledger_reserved
       FROM users u
       LEFT JOIN credit_accounts a ON a.user_id = u.id
       LEFT JOIN (SELECT user_id, sum(available_delta) AS av, sum(reserved_delta) AS rs FROM credit_ledger GROUP BY user_id) l
       ON l.user_id = u.id
      WHERE coalesce(a.available, 0) <> coalesce(l.av, 0) OR coalesce(a.reserved, 0) <> coalesce(l.rs, 0)`,
    [],
    db,
  );
}
