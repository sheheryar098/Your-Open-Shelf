import { requireUser } from "@/shared/api/session";
import { fmtDate } from "@/shared/lib/format";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { changePasswordAction, closeAccountAction } from "@/features/accounts/api/actions";

export const metadata = { title: "Account & privacy" };

export default async function AccountSettings() {
  const u = await requireUser("/settings/account");
  return (
    <>
      <section className="card">
        <h2>Account</h2>
        <dl className="dl">
          <dt>Email</dt><dd>{u.email} {u.email_verified_at ? <span className="badge badge-ok">Verified</span> : <span className="badge badge-warn">Not verified</span>}</dd>
          <dt>Member since</dt><dd>{fmtDate(u.created_at)}</dd>
          <dt>Plan</dt><dd>{u.plan === "plus" ? "YOS Plus" : "Free"}</dd>
        </dl>
      </section>
      <section className="card">
        <h2>Change password</h2>
        <ActionForm action={changePasswordAction} resetOnSuccess>
          <div className="field"><label htmlFor="current">Current password</label><input id="current" name="current" type="password" required autoComplete="current-password" /></div>
          <div className="field-row">
            <div className="field"><label htmlFor="next">New password</label><input id="next" name="next" type="password" required minLength={10} autoComplete="new-password" /></div>
            <div className="field"><label htmlFor="confirm">Confirm new password</label><input id="confirm" name="confirm" type="password" required minLength={10} autoComplete="new-password" /></div>
          </div>
          <SubmitButton>Change password</SubmitButton>
        </ActionForm>
      </section>
      <section className="card">
        <h2>Your data</h2>
        <p className="small">Download a copy of everything YOS holds about you: profile, addresses, listings, exchanges, credit history, reviews and support tickets.</p>
        <a href="/api/v1/me/export" className="btn">Download my data (JSON)</a>
      </section>
      <section className="card" style={{ borderColor: "var(--danger)" }}>
        <h2>Close account</h2>
        <p className="small">
          Closing your account removes your profile, addresses, wish list and listings. Unused credits can&apos;t be paid out. Your credit
          history is kept as an anonymized financial record. Finish or cancel in-progress exchanges first.
        </p>
        <ActionForm action={closeAccountAction} confirm="Close your YOS account permanently?">
          <div className="field-row">
            <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" required autoComplete="current-password" /></div>
            <div className="field"><label htmlFor="confirmText">Type CLOSE to confirm</label><input id="confirmText" name="confirmText" type="text" required /></div>
          </div>
          <SubmitButton className="btn btn-danger">Close my account</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}
