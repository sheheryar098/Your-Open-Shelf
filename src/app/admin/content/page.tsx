import { requirePermission } from "@/lib/auth/session";
import { query } from "@/lib/db";
import { fmtDateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge } from "@/components/ui";
import { announcementAction, toggleAnnouncementAction } from "@/app/actions/admin";

export const metadata = { title: "Announcements" };

export default async function AdminContent() {
  await requirePermission("content.manage");
  const rows = await query<{ id: string; message: string; level: string; active: boolean; created_at: Date }>(
    "SELECT id, message, level, active, created_at FROM announcements ORDER BY created_at DESC LIMIT 50",
  );
  return (
    <>
      <h1>Announcements</h1>
      <p className="muted small">Site-wide banners (up to two active are shown). Help-center and policy content lives in the codebase so changes are reviewed.</p>
      <section className="card">
        <ActionForm action={announcementAction} resetOnSuccess>
          <div className="field"><label htmlFor="message">Message</label><textarea id="message" name="message" required maxLength={500} rows={2} /></div>
          <div className="row">
            <select name="level" defaultValue="info" aria-label="Level"><option value="info">Info</option><option value="warning">Warning</option></select>
            <SubmitButton className="btn btn-sm">Publish announcement</SubmitButton>
          </div>
        </ActionForm>
      </section>
      <div className="card">
        {rows.map((a) => (
          <div key={a.id} className="list-item">
            <div className="body">
              <div>{a.message}</div>
              <div className="tiny muted">{fmtDateTime(a.created_at)} · {a.level}</div>
            </div>
            <Badge tone={a.active ? "ok" : undefined}>{a.active ? "Shown" : "Hidden"}</Badge>
            <ActionForm action={toggleAnnouncementAction.bind(null, a.id, !a.active)} className="inline-form">
              <SubmitButton className="btn btn-sm">{a.active ? "Hide" : "Show"}</SubmitButton>
            </ActionForm>
          </div>
        ))}
      </div>
    </>
  );
}
