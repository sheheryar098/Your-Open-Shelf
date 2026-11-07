import Link from "next/link";
import { currentUser } from "@/shared/api/session";
import { verifyEmail } from "@/server/domain/users";
import { ActionForm, SubmitButton } from "@/shared/ui/ActionForm";
import { resendVerificationAction } from "@/features/accounts/api/auth-actions";
import { devOutboxEnabled } from "@/server/config";

export const metadata = { title: "Verify your email" };

export default async function VerifyEmail({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (token) {
    const ok = await verifyEmail(token);
    return (
      <div className="container tight page">
        {ok ? (
          <>
            <h1>Email verified</h1>
            <p>Thanks! You can now list and request books.</p>
            <div className="row">
              <Link href="/my/books/new" className="btn btn-primary">List a book</Link>
              <Link href="/explore" className="btn">Explore books</Link>
            </div>
          </>
        ) : (
          <>
            <h1>That link didn&apos;t work</h1>
            <p>The verification link is invalid, already used, or expired.</p>
            <Link href="/verify-email" className="btn">Request a new link</Link>
          </>
        )}
      </div>
    );
  }
  const user = await currentUser();
  return (
    <div className="container tight page">
      <h1>Verify your email</h1>
      {!user ? (
        <p><Link href="/signin?next=/verify-email">Sign in</Link> to request a new verification link.</p>
      ) : user.email_verified_at ? (
        <p>Your email address is already verified.</p>
      ) : (
        <>
          <p>We sent a link to <strong>{user.email}</strong>. Click it to verify your address. Check your spam folder if you can&apos;t find it.</p>
          <ActionForm action={resendVerificationAction}>
            <SubmitButton className="btn">Send a new link</SubmitButton>
          </ActionForm>
          {devOutboxEnabled() && (
            <p className="small muted" style={{ marginTop: 16 }}>
              Development mode: emails aren&apos;t sent. Open the <Link href="/dev/outbox">development outbox</Link> to click the link.
            </p>
          )}
        </>
      )}
    </div>
  );
}
