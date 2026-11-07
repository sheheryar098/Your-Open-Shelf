import { requireUser } from "@/shared/api/session";
import { NOTIFICATION_TYPES } from "@/server/domain/notifications";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { notificationPrefsAction } from "@/features/accounts/api/actions";

export const metadata = { title: "Notification preferences" };

export default async function NotificationSettings() {
  const u = await requireUser("/settings/notifications");
  const optional = Object.entries(NOTIFICATION_TYPES).filter(([, m]) => !m.essential);
  const essential = Object.entries(NOTIFICATION_TYPES).filter(([, m]) => m.essential);
  return (
    <section className="card">
      <h2>Notifications</h2>
      <ActionForm action={notificationPrefsAction}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Notification</th><th>On YOS</th><th>Email</th></tr></thead>
            <tbody>
              {optional.map(([k, m]) => {
                const p = u.notification_prefs[k] ?? {};
                return (
                  <tr key={k}>
                    <td>{m.label}</td>
                    <td><input type="checkbox" name={`${k}.inSite`} defaultChecked={p.inSite !== false} aria-label={`${m.label} on YOS`} /></td>
                    <td><input type="checkbox" name={`${k}.email`} defaultChecked={p.email === true} aria-label={`${m.label} by email`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <SubmitButton>Save preferences</SubmitButton>
      </ActionForm>
      <p className="small muted" style={{ marginTop: 16 }}>
        Always sent (needed to complete exchanges and keep your account safe): {essential.map(([, m]) => m.label.toLowerCase()).join("; ")}.
      </p>
    </section>
  );
}
