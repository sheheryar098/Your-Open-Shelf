import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, destroySession, userForSession, type User } from "@/server/domain/users";
import { can, type Permission } from "@/server/rbac";
import { ForbiddenError } from "@/server/errors";

const COOKIE = "yos_session";

export const currentUser = cache(async (): Promise<User | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return userForSession(token);
});

export async function startSession(userId: string) {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const { token, expires } = await createSession(userId, { ip, userAgent: h.get("user-agent") });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await destroySession(token);
  jar.delete(COOKIE);
}

/** For pages: redirect to sign-in when signed out. */
export async function requireUser(next?: string): Promise<User> {
  const u = await currentUser();
  if (!u) redirect(`/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return u;
}

/** For pages: require a staff permission, otherwise 404 to avoid revealing admin routes. */
export async function requirePermission(perm: Permission): Promise<User> {
  const u = await requireUser("/admin");
  if (!can(u.role, perm)) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
  return u;
}

/** For server actions: throw instead of redirecting. */
export async function actionUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new ForbiddenError("Please sign in to continue.");
  return u;
}

export async function actionStaff(perm: Permission): Promise<User> {
  const u = await actionUser();
  if (!can(u.role, perm)) throw new ForbiddenError();
  return u;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}
