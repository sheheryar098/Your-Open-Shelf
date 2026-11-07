"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { bool, file, run, str, type ActionState } from "@/shared/api/action";
import { DomainError } from "@/server/errors";
import { query, tx } from "@/server/db";
import { actionUser, endSession } from "@/shared/api/session";
import { COUNTRY_COOKIE } from "@/shared/api/geo";
import { NOTIFICATION_TYPES } from "@/server/domain/notifications";
import { saveUpload } from "@/server/domain/files";
import {
  changePassword, closeAccount, profileSchema, updateNotificationPrefs, updateProfile, updateShippingPreferences,
} from "@/server/domain/users";
import { addressSchema, deleteAddress, saveAddress } from "@/server/domain/support";

export async function profileAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    const parsed = profileSchema.safeParse({
      displayName: str(fd, "displayName"),
      bio: str(fd, "bio"),
      country: str(fd, "country").toUpperCase(),
      preferredLanguage: str(fd, "preferredLanguage") || "en",
      timezone: str(fd, "timezone") || "UTC",
    });
    if (!parsed.success) throw new DomainError(parsed.error.issues[0].message);
    await updateProfile(u.id, parsed.data);
    const avatar = file(fd, "avatar");
    if (avatar) {
      await tx(async (c) => {
        const id = await saveUpload(c, avatar, "avatar", u.id);
        await c.query("UPDATE users SET avatar_file_id = $2 WHERE id = $1", [u.id, id]);
      });
    }
    (await cookies()).set(COUNTRY_COOKIE, parsed.data.country.toUpperCase(), { path: "/", maxAge: 365 * 86400, sameSite: "lax" });
    return "Profile saved.";
  });
}

export async function shippingPrefsAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    const scope = str(fd, "shipScope") === "international" ? "international" : "domestic";
    await updateShippingPreferences(u.id, scope, fd.getAll("shipCountries").map(String), bool(fd, "applyToListings"));
    return "Shipping preferences saved.";
  });
}

export async function notificationPrefsAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    const prefs: Record<string, { inSite: boolean; email: boolean }> = {};
    for (const [type, meta] of Object.entries(NOTIFICATION_TYPES)) {
      if (meta.essential) continue;
      prefs[type] = { inSite: bool(fd, `${type}.inSite`), email: bool(fd, `${type}.email`) };
    }
    await updateNotificationPrefs(u.id, prefs);
    return "Notification preferences saved.";
  });
}

function parseAddress(fd: FormData) {
  const parsed = addressSchema.safeParse({
    label: str(fd, "label"),
    recipientName: str(fd, "recipientName"),
    line1: str(fd, "line1"),
    line2: str(fd, "line2"),
    city: str(fd, "city"),
    region: str(fd, "region"),
    postalCode: str(fd, "postalCode"),
    country: str(fd, "country").toUpperCase(),
    phone: str(fd, "phone"),
    isDefault: bool(fd, "isDefault"),
  });
  if (!parsed.success) throw new DomainError(parsed.error.issues[0].message);
  return parsed.data;
}

export async function saveAddressAction(id: string | null, _: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    await saveAddress(u.id, parseAddress(fd), id ?? undefined);
    const back = str(fd, "back");
    if (back.startsWith("/") && !back.startsWith("//")) redirect(back);
    return "Address saved.";
  });
}

export async function deleteAddressAction(id: string, _: ActionState) {
  return run(async () => {
    const u = await actionUser();
    await deleteAddress(u.id, id);
    return "Address removed.";
  });
}

export async function changePasswordAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    if (str(fd, "next") !== str(fd, "confirm")) throw new DomainError("The new passwords don't match.");
    await changePassword(u.id, str(fd, "current"), str(fd, "next"));
    return "Password changed.";
  });
}

export async function closeAccountAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const u = await actionUser();
    if (str(fd, "confirmText") !== "CLOSE") throw new DomainError("Type CLOSE to confirm.");
    await closeAccount(u.id, str(fd, "password"));
    await endSession();
    redirect("/?closed=1");
  });
}

export async function markAllReadAction(_: ActionState) {
  return run(async () => {
    const u = await actionUser();
    await query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [u.id]);
  });
}
