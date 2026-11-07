import Link from "next/link";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { resetPasswordAction } from "@/features/accounts/api/auth-actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <div className="container tight page">
        <h1>Reset link missing</h1>
        <p><Link href="/forgot-password">Request a new reset link</Link>.</p>
      </div>
    );
  }
  return (
    <div className="container tight page">
      <h1>Choose a new password</h1>
      <ActionForm action={resetPasswordAction}>
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <label htmlFor="password">New password</label>
          <input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" />
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirm new password</label>
          <input id="confirm" name="confirm" type="password" minLength={10} required autoComplete="new-password" />
        </div>
        <SubmitButton>Save password</SubmitButton>
      </ActionForm>
    </div>
  );
}
