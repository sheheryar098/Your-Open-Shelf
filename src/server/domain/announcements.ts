import { query, tx } from "@/server/db";
import { DomainError } from "@/server/errors";
import { audit, auditStaffAction } from "./audit";

export interface Announcement {
  id: string;
  message: string;
  level: "info" | "warning";
}

/** Banners shown site-wide. The layout renders at most two. */
export async function activeAnnouncements(limit = 2) {
  return query<Announcement>(
    "SELECT id, message, level FROM announcements WHERE active ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
}

export async function createAnnouncement(adminId: string, message: string, level: Announcement["level"]) {
  const text = message.trim();
  if (text.length < 5) throw new DomainError("Write the announcement.");
  await tx(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      "INSERT INTO announcements (message, level, created_by) VALUES ($1, $2, $3) RETURNING id",
      [text.slice(0, 500), level, adminId],
    );
    await audit(c, {
      actorId: adminId,
      action: "announcement.create",
      targetType: "announcement",
      targetId: rows[0].id,
    });
  });
}

export async function setAnnouncementActive(adminId: string, id: string, active: boolean) {
  await query("UPDATE announcements SET active = $2 WHERE id = $1", [id, active]);
  await auditStaffAction({
    actorId: adminId,
    action: active ? "announcement.activate" : "announcement.deactivate",
    targetType: "announcement",
    targetId: id,
  });
}
