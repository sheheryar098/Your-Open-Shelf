"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { run, str, type ActionState } from "@/shared/api/action";
import { DomainError } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { clientIp, currentUser, endSession, startSession } from "@/shared/api/session";
import { COUNTRY_COOKIE } from "@/shared/api/geo";
import { isCountryCode } from "@/shared/lib/countries";
import {
  authenticate, registerSchema, registerUser, requestPasswordReset, resendVerification, resetPassword,
} from "@/server/domain/users";
import { query } from "@/server/db";

function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function registerAction(_: ActionState, fd: FormData) {
  return run(async () => {
    enforceRateLimit(`register:${await clientIp()}`, 5, 60 * 60_000);
    const parsed = registerSchema.safeParse({
      displayName: str(fd, "displayName"),
      email: str(fd, "email"),
      password: str(fd, "password"),
      country: str(fd, "country").toUpperCase(),
      acceptTerms: fd.get("acceptTerms") ?? undefined,
      confirmAge: fd.get("confirmAge") ?? undefined,
    });
    if (!parsed.success) throw new DomainError(parsed.error.issues[0].message);
    const id = await registerUser(parsed.data);
    await startSession(id);
    (await cookies()).set(COUNTRY_COOKIE, parsed.data.country.toUpperCase(), { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
    redirect("/welcome");
  });
}

export async function signInAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const email = str(fd, "email");
    enforceRateLimit(`signin:${await clientIp()}`, 20, 15 * 60_000);
    enforceRateLimit(`signin:${email.toLowerCase()}`, 8, 15 * 60_000, "Too many sign-in attempts for this account. Try again in 15 minutes or reset your password.");
    const user = await authenticate(email, str(fd, "password"));
    await startSession(user.id);
    if (user.country_code) {
      (await cookies()).set(COUNTRY_COOKIE, user.country_code, { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
    }
    redirect(safeNext(str(fd, "next")));
  });
}

export async function signOutAction() {
  await endSession();
  redirect("/");
}

export async function resendVerificationAction(_: ActionState) {
  return run(async () => {
    const u = await currentUser();
    if (!u) throw new DomainError("Please sign in first.");
    enforceRateLimit(`verify:${u.id}`, 3, 60 * 60_000);
    await resendVerification(u.id);
    return "We've sent a new verification link to your email.";
  });
}

export async function forgotPasswordAction(_: ActionState, fd: FormData) {
  return run(async () => {
    enforceRateLimit(`forgot:${await clientIp()}`, 5, 60 * 60_000);
    await requestPasswordReset(str(fd, "email"));
    return "If an account exists for that email, we've sent a reset link. It expires in 2 hours.";
  });
}

export async function resetPasswordAction(_: ActionState, fd: FormData) {
  return run(async () => {
    if (str(fd, "password") !== str(fd, "confirm")) throw new DomainError("The passwords don't match.");
    await resetPassword(str(fd, "token"), str(fd, "password"));
    redirect("/signin?reset=1");
  });
}

/** Saves the visitor's country choice (§4.1). Signed-in members change it in their profile. */
export async function setCountryAction(fd: FormData) {
  const code = str(fd, "country").toUpperCase();
  if (!isCountryCode(code)) return;
  (await cookies()).set(COUNTRY_COOKIE, code, { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
  const u = await currentUser();
  if (u && !u.country_code) await query("UPDATE users SET country_code = $2 WHERE id = $1", [u.id, code]);
  const back = str(fd, "back");
  if (back) redirect(safeNext(back));
}
