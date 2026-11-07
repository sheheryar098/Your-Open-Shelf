import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/shared/api/session";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { signInAction } from "@/features/accounts/api/auth-actions";

export const metadata = { title: "Sign in" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  if (await currentUser()) redirect(sp.next?.startsWith("/") ? sp.next : "/dashboard");
  return (
    <div className="container tight page">
      <h1>Sign in</h1>
      {sp.reset && <div className="alert alert-ok" style={{ marginBottom: 16 }}>Your password has been reset. Sign in with your new password.</div>}
      <ActionForm action={signInAction}>
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <p className="small" style={{ marginTop: 16 }}>
        <Link href="/forgot-password">Forgot your password?</Link> · New to YOS? <Link href="/signup">Create an account</Link>
      </p>
    </div>
  );
}
