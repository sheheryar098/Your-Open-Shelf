import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session";
import { chosenCountry, suggestedCountry } from "@/lib/geo";
import { policy } from "@/lib/config";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { CountrySelect } from "@/components/ui";
import { registerAction } from "@/app/actions/auth";

export const metadata = { title: "Join YOS" };

export default async function SignUp() {
  if (await currentUser()) redirect("/dashboard");
  const country = (await chosenCountry()) ?? (await suggestedCountry());
  return (
    <div className="container tight page">
      <h1>Join YOS</h1>
      <p className="muted">Free to join. List books you&apos;re ready to pass on, and earn credits to request your next read.</p>
      <ActionForm action={registerAction}>
        <div className="field">
          <label htmlFor="country">Country</label>
          <CountrySelect defaultValue={country} />
          <span className="help">{country ? "We suggested this from your connection — change it if it's wrong." : "Where you'll send and receive books."}</span>
        </div>
        <div className="field">
          <label htmlFor="displayName">Display name</label>
          <input id="displayName" name="displayName" type="text" required minLength={2} maxLength={40} autoComplete="nickname" />
          <span className="help">Shown publicly on your listings and profile. You don&apos;t need to use your full name.</span>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" />
          <span className="help">At least 10 characters.</span>
        </div>
        <label className="check">
          <input type="checkbox" name="acceptTerms" required />
          <span>
            I accept the <Link href="/legal/terms" target="_blank">Terms of Service</Link>, <Link href="/legal/privacy" target="_blank">Privacy Policy</Link>,{" "}
            <Link href="/legal/credits" target="_blank">Credit System Terms</Link> and <Link href="/legal/disputes" target="_blank">exchange rules</Link>.
          </span>
        </label>
        <label className="check">
          <input type="checkbox" name="confirmAge" required />
          <span>I am at least {policy.minimumAge} years old.</span>
        </label>
        <SubmitButton pendingText="Creating your account…">Create account</SubmitButton>
      </ActionForm>
      <p className="small" style={{ marginTop: 16 }}>
        Already a member? <Link href="/signin">Sign in</Link>
      </p>
    </div>
  );
}
