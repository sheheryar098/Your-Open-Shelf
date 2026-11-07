import { z } from "zod";
import { pool, query, queryOne, tx, isUniqueViolation, type Db } from "@/server/db";
import { hashPassword, verifyPassword, randomToken, sha256 } from "@/server/auth/password";
import { DomainError } from "@/server/errors";
import { isCountryCode } from "@/shared/lib/countries";
import { policy, appUrl } from "@/server/config";
import { addDays, addHours, now } from "@/server/clock";
import { EmailPriority, notify, queueEmail } from "./notifications";
import { audit, requireReason } from "./audit";
import { saveUpload } from "./files";

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: "member" | "moderator" | "admin";
  status: "active" | "suspended" | "closed";
  status_reason: string | null;
  email_verified_at: Date | null;
  country_code: string | null;
  preferred_language: string;
  timezone: string;
  bio: string | null;
  avatar_file_id: string | null;
  can_list: boolean;
  can_request: boolean;
  restriction_reason: string | null;
  plan: "free" | "plus";
  ship_scope: "domestic" | "international";
  ship_countries: string[];
  notification_prefs: Record<string, { inSite?: boolean; email?: boolean }>;
  created_at: Date;
  last_login_at: Date | null;
}

const USER_COLUMNS = `id, email, display_name, role, status, status_reason, email_verified_at, country_code,
  preferred_language, timezone, bio, avatar_file_id, can_list, can_request, restriction_reason, plan,
  ship_scope, ship_countries, notification_prefs, created_at, last_login_at`;

export async function getUser(id: string, db?: Db) {
  return queryOne<User>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id], db);
}

export const registerSchema = z.object({
  displayName: z.string().trim().min(2, "Display name must be at least 2 characters.").max(40),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z.string().min(10, "Use at least 10 characters for your password.").max(200),
  country: z.string().refine(isCountryCode, "Choose your country."),
  acceptTerms: z.literal("on", { message: "You need to accept the Terms of Service and Privacy Policy." }),
  confirmAge: z.literal("on", { message: `You must be at least ${policy.minimumAge} to join YOS.` }),
});

export async function registerUser(input: z.infer<typeof registerSchema>) {
  const passwordHash = await hashPassword(input.password);
  try {
    return await tx(async (c) => {
      const t = now();
      const u = (
        await c.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, display_name, country_code, terms_version, terms_accepted_at, age_confirmed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
          [input.email, passwordHash, input.displayName, input.country.toUpperCase(), policy.termsVersion, t],
        )
      ).rows[0];
      await c.query("INSERT INTO credit_accounts (user_id) VALUES ($1)", [u.id]);
      await issueVerification(c, u.id, input.email, input.displayName);
      return u.id;
    });
  } catch (err) {
    if (isUniqueViolation(err, "users_email_unique")) {
      throw new DomainError("An account with this email already exists. Try signing in instead.");
    }
    throw err;
  }
}

async function issueVerification(db: Db, userId: string, email: string, name: string) {
  const token = randomToken();
  await query(
    "INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, 'verify_email', $3)",
    [sha256(token), userId, addDays(now(), 3)],
    db,
  );
  await queueEmail(
    db,
    email,
    "Verify your YOS email address",
    `Hi ${name},\n\nWelcome to YOS — Your Open Shelf. Please confirm your email address:\n\n${appUrl()}/verify-email?token=${token}\n\nThis link expires in 3 days.`,
    EmailPriority.security,
  );
  return token;
}

export async function resendVerification(userId: string) {
  const u = await getUser(userId);
  if (!u || u.email_verified_at) return;
  await issueVerification(pool(), u.id, u.email, u.display_name);
}

export async function verifyEmail(token: string): Promise<string | null> {
  return tx(async (c) => {
    const row = (
      await c.query<{ user_id: string }>(
        `UPDATE email_tokens SET used_at = $2
          WHERE token_hash = $1 AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > $2
         RETURNING user_id`,
        [sha256(token), now()],
      )
    ).rows[0];
    if (!row) return null;
    await c.query(
      "UPDATE users SET email_verified_at = coalesce(email_verified_at, $2), updated_at = now() WHERE id = $1",
      [row.user_id, now()],
    );
    return row.user_id;
  });
}

export async function authenticate(email: string, password: string): Promise<User> {
  const row = await queryOne<{ id: string; password_hash: string; status: string }>(
    "SELECT id, password_hash, status FROM users WHERE lower(email) = lower($1)",
    [email.trim()],
  );
  // Always run a hash comparison to keep timing similar for unknown emails.
  const ok = await verifyPassword(password, row?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!row || !ok) throw new DomainError("Email or password is incorrect.");
  if (row.status === "closed") throw new DomainError("This account has been closed.");
  if (row.status === "suspended") {
    throw new DomainError("This account is suspended. Contact support if you believe this is a mistake.");
  }
  await query("UPDATE users SET last_login_at = $2 WHERE id = $1", [row.id, now()]);
  return (await getUser(row.id))!;
}

// ---------------------------------------------------------------------------
// Sessions (cookie token -> sha256 stored)
// ---------------------------------------------------------------------------

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomToken();
  const expires = addDays(now(), policy.sessionDays);
  await query("INSERT INTO sessions (id_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, $3, $4, $5)", [
    sha256(token),
    userId,
    expires,
    meta.ip ?? null,
    meta.userAgent?.slice(0, 300) ?? null,
  ]);
  return { token, expires };
}

export async function userForSession(token: string): Promise<User | null> {
  const row = await queryOne<{ user_id: string }>(
    "SELECT user_id FROM sessions WHERE id_hash = $1 AND expires_at > $2",
    [sha256(token), now()],
  );
  if (!row) return null;
  const u = await getUser(row.user_id);
  if (!u || u.status !== "active") return null;
  return u;
}

export async function destroySession(token: string) {
  await query("DELETE FROM sessions WHERE id_hash = $1", [sha256(token)]);
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function requestPasswordReset(email: string) {
  const u = await queryOne<{ id: string; email: string; display_name: string; status: string }>(
    "SELECT id, email, display_name, status FROM users WHERE lower(email) = lower($1)",
    [email.trim()],
  );
  if (!u || u.status === "closed") return; // don't reveal whether the account exists
  const token = randomToken();
  await query(
    "INSERT INTO email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, 'reset_password', $3)",
    [sha256(token), u.id, addHours(now(), 2)],
  );
  await queueEmail(
    pool(),
    u.email,
    "Reset your YOS password",
    `Hi ${u.display_name},\n\nSomeone asked to reset your YOS password. If that was you, use this link within 2 hours:\n\n${appUrl()}/reset-password?token=${token}\n\nIf it wasn't you, you can ignore this email.`,
    EmailPriority.security,
  );
}

export async function resetPassword(token: string, newPassword: string) {
  if (newPassword.length < 10) throw new DomainError("Use at least 10 characters for your password.");
  const hash = await hashPassword(newPassword);
  await tx(async (c) => {
    const row = (
      await c.query<{ user_id: string }>(
        `UPDATE email_tokens SET used_at = $2
          WHERE token_hash = $1 AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > $2
         RETURNING user_id`,
        [sha256(token), now()],
      )
    ).rows[0];
    if (!row) throw new DomainError("This reset link is invalid or has expired.");
    await c.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [row.user_id, hash]);
    await c.query("DELETE FROM sessions WHERE user_id = $1", [row.user_id]);
    await notify(c, row.user_id, {
      type: "security",
      title: "Your YOS password was changed",
      body: "If you didn't do this, contact support immediately.",
    });
  });
}

export async function setAvatar(userId: string, file: File) {
  await tx(async (c) => {
    const fileId = await saveUpload(c, file, "avatar", userId);
    await c.query("UPDATE users SET avatar_file_id = $2, updated_at = now() WHERE id = $1", [userId, fileId]);
  });
}

/** Stores the country a signed-in member picked from the country banner, if they had none. */
export async function setCountryIfMissing(userId: string, code: string) {
  if (!isCountryCode(code)) return;
  await query("UPDATE users SET country_code = $2 WHERE id = $1 AND country_code IS NULL", [
    userId,
    code.toUpperCase(),
  ]);
}

export async function changePassword(userId: string, current: string, next: string) {
  const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [userId]);
  if (!row || !(await verifyPassword(current, row.password_hash)))
    throw new DomainError("Your current password is incorrect.");
  if (next.length < 10) throw new DomainError("Use at least 10 characters for your new password.");
  await query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [
    userId,
    await hashPassword(next),
  ]);
  await notify(pool(), userId, {
    type: "security",
    title: "Your YOS password was changed",
    body: "If you didn't do this, contact support immediately.",
  });
}

// ---------------------------------------------------------------------------
// Profile & preferences
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(40),
  bio: z.string().trim().max(500).optional().default(""),
  country: z.string().refine(isCountryCode, "Choose your country."),
  preferredLanguage: z.string().min(2).max(8),
  timezone: z.string().min(1).max(64),
});

export async function updateProfile(userId: string, p: z.infer<typeof profileSchema>) {
  const country = p.country.toUpperCase();
  const prev = await getUser(userId);
  if (prev && prev.country_code !== country) {
    const live = await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM exchanges WHERE (sender_id = $1 OR requester_id = $1)
       AND status IN ('requested','accepted','shipped','delivered','disputed')`,
      [userId],
    );
    if (Number(live?.n) > 0)
      throw new DomainError("You can change your country once your in-progress exchanges are finished.");
  }
  let tz = "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: p.timezone });
    tz = p.timezone;
  } catch {
    throw new DomainError("Unknown time zone.");
  }
  await tx(async (c) => {
    await c.query(
      `UPDATE users SET display_name = $2, bio = nullif($3, ''), country_code = $4, preferred_language = $5,
        timezone = $6, updated_at = now()
        WHERE id = $1`,
      [userId, p.displayName, p.bio, country, p.preferredLanguage, tz],
    );
    if (prev && prev.country_code !== country) {
      // Active listings move with the member's country; they keep their own shipping settings.
      await c.query(
        `UPDATE listings SET origin_country = $2, updated_at = now()
          WHERE owner_id = $1 AND status IN ('draft','active','paused','unavailable')`,
        [userId, country],
      );
    }
  });
}

export async function updateShippingPreferences(
  userId: string,
  scope: "domestic" | "international",
  countries: string[],
  applyToListings: boolean,
) {
  const clean = [...new Set(countries.map((c) => c.toUpperCase()).filter(isCountryCode))];
  await tx(async (c) => {
    await c.query("UPDATE users SET ship_scope = $2, ship_countries = $3, updated_at = now() WHERE id = $1", [
      userId,
      scope,
      clean,
    ]);
    if (applyToListings) {
      await c.query(
        `UPDATE listings SET ship_scope = $2, ship_countries = $3, updated_at = now()
          WHERE owner_id = $1 AND status IN ('draft','active','paused','unavailable')`,
        [userId, scope, clean],
      );
    }
  });
}

export async function updateNotificationPrefs(
  userId: string,
  prefs: Record<string, { inSite: boolean; email: boolean }>,
) {
  await query("UPDATE users SET notification_prefs = $2, updated_at = now() WHERE id = $1", [
    userId,
    JSON.stringify(prefs),
  ]);
}

// ---------------------------------------------------------------------------
// Privacy: data export and account closure
// ---------------------------------------------------------------------------

export async function exportUserData(userId: string) {
  const [user, addresses, listings, exchanges, ledger, reviews, tickets] = await Promise.all([
    getUser(userId),
    query("SELECT * FROM addresses WHERE user_id = $1", [userId]),
    query("SELECT l.*, b.title FROM listings l JOIN books b ON b.id = l.book_id WHERE owner_id = $1", [userId]),
    query("SELECT * FROM exchanges WHERE requester_id = $1 OR sender_id = $1", [userId]),
    query("SELECT * FROM credit_ledger WHERE user_id = $1 ORDER BY id", [userId]),
    query("SELECT * FROM reviews WHERE reviewer_id = $1 OR reviewee_id = $1", [userId]),
    query("SELECT * FROM support_tickets WHERE user_id = $1", [userId]),
  ]);
  return {
    exportedAt: now().toISOString(),
    user,
    addresses,
    listings,
    exchanges,
    creditLedger: ledger,
    reviews,
    supportTickets: tickets,
  };
}

/**
 * Closes an account and removes personal data that isn't needed for the ledger, open cases
 * or legal retention. Ledger rows are kept (they reference the pseudonymous user id).
 */
export async function closeAccount(userId: string, password: string) {
  const row = await queryOne<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [userId]);
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new DomainError("Password is incorrect.");
  const live = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM exchanges WHERE (sender_id = $1 OR requester_id = $1)
     AND status IN ('requested','accepted','shipped','delivered','disputed')`,
    [userId],
  );
  if (Number(live?.n) > 0)
    throw new DomainError("Please finish or cancel your in-progress exchanges before closing your account.");
  await tx(async (c) => {
    await c.query(
      `UPDATE users SET status = 'closed', email = 'closed+' || id || '@invalid.yos', display_name = 'Former member',
         bio = NULL, avatar_file_id = NULL, password_hash = 'closed', notification_prefs = '{}', updated_at = now()
        WHERE id = $1`,
      [userId],
    );
    await c.query(
      `UPDATE addresses SET deleted_at = now(), recipient_name = '', line1 = '', line2 = NULL, phone = NULL
        WHERE user_id = $1`,
      [userId],
    );
    await c.query(
      `UPDATE listings SET status = 'removed', status_reason = 'Account closed', updated_at = now()
        WHERE owner_id = $1 AND status <> 'exchanged'`,
      [userId],
    );
    await c.query("DELETE FROM wishlist_items WHERE user_id = $1", [userId]);
    await c.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  });
}

// ---------------------------------------------------------------------------
// Staff member management
// ---------------------------------------------------------------------------

export async function setRestrictions(
  staffId: string,
  userId: string,
  r: { canList: boolean; canRequest: boolean },
  reason: string,
) {
  const why = requireReason(reason);
  await tx(async (c) => {
    await c.query(
      "UPDATE users SET can_list = $2, can_request = $3, restriction_reason = $4, updated_at = now() WHERE id = $1",
      [userId, r.canList, r.canRequest, r.canList && r.canRequest ? null : why],
    );
    await audit(c, {
      actorId: staffId,
      action: "member.restrict",
      targetType: "user",
      targetId: userId,
      reason: why,
      metadata: r,
    });
    await notify(c, userId, {
      type: "security",
      title:
        r.canList && r.canRequest
          ? "Restrictions on your account were lifted"
          : "Some actions on your account are restricted",
      body: r.canList && r.canRequest ? undefined : `Reason: ${why}. You can appeal by contacting support.`,
      link: "/support",
    });
  });
}

export async function setAccountStatus(
  staffId: string,
  userId: string,
  status: "active" | "suspended",
  reason: string,
) {
  const why = requireReason(reason);
  if (staffId === userId) throw new DomainError("You can't change your own account status.");
  await tx(async (c) => {
    await c.query(
      "UPDATE users SET status = $2, status_reason = $3, updated_at = now() WHERE id = $1 AND status <> 'closed'",
      [userId, status, why],
    );
    if (status === "suspended") {
      await c.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
      await c.query(
        `UPDATE listings SET status = 'paused', status_reason = 'Account suspended', updated_at = now()
          WHERE owner_id = $1 AND status = 'active'`,
        [userId],
      );
    }
    await audit(c, {
      actorId: staffId,
      action: `member.${status === "active" ? "reinstate" : "suspend"}`,
      targetType: "user",
      targetId: userId,
      reason: why,
    });
    await notify(c, userId, {
      type: "security",
      title: status === "suspended" ? "Your YOS account has been suspended" : "Your YOS account has been reinstated",
      body: status === "suspended" ? `Reason: ${why}. Reply to support to appeal this decision.` : undefined,
    });
  });
}

export async function setRole(adminId: string, userId: string, role: User["role"], reason: string) {
  const why = requireReason(reason);
  if (adminId === userId) throw new DomainError("You can't change your own role.");
  await tx(async (c) => {
    await c.query("UPDATE users SET role = $2, updated_at = now() WHERE id = $1", [userId, role]);
    await audit(c, {
      actorId: adminId,
      action: "member.role",
      targetType: "user",
      targetId: userId,
      reason: why,
      metadata: { role },
    });
  });
}
