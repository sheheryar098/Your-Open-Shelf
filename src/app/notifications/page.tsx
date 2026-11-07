import Link from "next/link";
import { requireUser } from "@/shared/api/session";
import { query } from "@/server/db";
import { fmtDateTime } from "@/shared/lib/format";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { Empty } from "@/shared/ui/primitives";
import { markAllReadAction } from "@/features/accounts/api/actions";

export const metadata = { title: "Notifications" };

export default async function Notifications() {
  const u = await requireUser("/notifications");
  const items = await query<{ id: string; title: string; body: string | null; link: string | null; read_at: Date | null; created_at: Date }>(
    "SELECT id, title, body, link, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
    [u.id],
  );
  const unread = items.filter((i) => !i.read_at).length;
  return (
    <div className="container narrow page">
      <div className="row-between">
        <h1 className="mb-0">Notifications</h1>
        <div className="row">
          <Link href="/settings/notifications" className="btn btn-ghost btn-sm">Preferences</Link>
          {unread > 0 && (
            <ActionForm action={markAllReadAction} className="inline-form">
              <SubmitButton className="btn btn-sm">Mark all as read</SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        {items.length === 0 ? <Empty>You&apos;re all caught up.</Empty> : (
          <div className="card">
            {items.map((n) => (
              <div key={n.id} className={`list-item ${n.read_at ? "" : "notice-unread"}`}>
                <div className="body">
                  <div style={{ fontWeight: n.read_at ? 400 : 600 }}>{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}</div>
                  {n.body && <div className="small muted" style={{ whiteSpace: "pre-line" }}>{n.body}</div>}
                </div>
                <span className="tiny muted nowrap">{fmtDateTime(n.created_at, u.timezone)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
