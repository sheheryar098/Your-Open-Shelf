import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { forgotPasswordAction } from "@/app/actions/auth";

export const metadata = { title: "Reset your password" };

export default function ForgotPassword() {
  return (
    <div className="container tight page">
      <h1>Reset your password</h1>
      <p className="muted">Enter your account email and we&apos;ll send you a reset link.</p>
      <ActionForm action={forgotPasswordAction}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <SubmitButton>Send reset link</SubmitButton>
      </ActionForm>
    </div>
  );
}
